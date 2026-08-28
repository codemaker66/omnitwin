$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw "PowerShell 7 or newer is required"
}
$PSNativeCommandUseErrorActionPreference = $true

$crateRoot = $PSScriptRoot
$targetTriple = "x86_64-pc-windows-msvc"
$expectedRustc = "rustc 1.87.0 (17067e9ac 2025-05-09)"
$expectedCargo = "cargo 1.87.0 (99624be96 2025-05-06)"
$expectedNode = "v22.18.0"
$expectedMsvcVersion = "14.44.35207"
$expectedWindowsSdkVersion = "10.0.26100.0"
$expectedCargoSha256 = "4ec4e44523bc28667db1e1a3febfa450938d8f6f50667b06218849f0a9d6dd4e"
$expectedRustcSha256 = "31219ec9fefef647623ca50fb119c36ecc737f80f06863b550a88bfaac85c193"
$expectedRustfmtSha256 = "0351ab67fa7684a502d0872b26acc9b073bddac0d44d08c87afcca20ff80f65d"
$expectedCargoFmtSha256 = "8222ac6b2d13dbd0b038ce235c75beda6e9c7dae46e50588c396d814c37d671d"
$expectedClippyDriverSha256 = "744dd700e045490aff0a96aa078a8d877bf66c70d39872c41cc60499cb91f4bb"
$expectedCargoClippySha256 = "2bd245c6eb51116b54e0864decfea6fe5b54b2731fc0d6b297a6111652008004"
$expectedNodeSha256 = "c22d1c59a1f767a1ed0178445a027f2257d318c55430fc819d48f269586822b7"
$expectedLinkerSha256 = "ca11e6c45debd34bf652dfe984c5360a531a005ed78bf72852330c9c2590cf0d"
$expectedDumpbinSha256 = "12a1cd87238bd66dfdb788b4fcdcb91ce4b3f81236aab12a7a29e5ae1d85af50"
$programFilesX86 = ${env:ProgramFiles(x86)}
$msvcRoot = Join-Path $programFilesX86 "Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\$expectedMsvcVersion"
$msvcBin = Join-Path $msvcRoot "bin\Hostx64\x64"
$linker = Join-Path $msvcBin "link.exe"
$dumpbin = Join-Path $msvcBin "dumpbin.exe"
$msvcLib = Join-Path $msvcRoot "lib\x64"
$windowsSdkRoot = Join-Path $programFilesX86 "Windows Kits\10"
$windowsSdkBin = Join-Path $windowsSdkRoot "bin\$expectedWindowsSdkVersion\x64"
$windowsSdkInclude = Join-Path $windowsSdkRoot "Include\$expectedWindowsSdkVersion"
$windowsSdkUcrtLib = Join-Path $windowsSdkRoot "Lib\$expectedWindowsSdkVersion\ucrt\x64"
$windowsSdkUmLib = Join-Path $windowsSdkRoot "Lib\$expectedWindowsSdkVersion\um\x64"
$toolchainBin = Join-Path $env:USERPROFILE ".rustup\toolchains\1.87.0-x86_64-pc-windows-msvc\bin"
$cargo = Join-Path $toolchainBin "cargo.exe"
$rustc = Join-Path $toolchainBin "rustc.exe"
$rustfmt = Join-Path $toolchainBin "rustfmt.exe"
$cargoFmt = Join-Path $toolchainBin "cargo-fmt.exe"
$clippyDriver = Join-Path $toolchainBin "clippy-driver.exe"
$cargoClippy = Join-Path $toolchainBin "cargo-clippy.exe"
$node = Join-Path $env:ProgramFiles "nodejs\node.exe"
$destination = Join-Path $crateRoot "grand_hall_t554_runtime_inspector.node"
$secondCopy = Join-Path $crateRoot "grand_hall_t554_runtime_inspector_copy.node"
$temporaryDestination = "$destination.$([Guid]::NewGuid().ToString('N')).tmp"
$temporaryBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$reproRoot = Join-Path $temporaryBase "t554-runtime-inspector-repro-$([Guid]::NewGuid().ToString('N'))"

function Assert-ExactFileSha256 {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$ExpectedSha256,
        [Parameter(Mandatory = $true)][string]$Label
    )
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Label is unavailable: $Path"
    }
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $ExpectedSha256) {
        throw "$Label SHA-256 differs from the reviewed input: $actual"
    }
    return $actual
}

function Get-ExactLibInventory {
    param([Parameter(Mandatory = $true)][string]$Root)
    $canonicalRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    if (-not (Test-Path -LiteralPath $canonicalRoot -PathType Container)) {
        throw "Reviewed library directory is unavailable: $canonicalRoot"
    }
    [string[]]$paths = @(
        [IO.Directory]::EnumerateFiles(
            $canonicalRoot,
            "*.lib",
            [IO.SearchOption]::TopDirectoryOnly
        )
    )
    [Array]::Sort($paths, [StringComparer]::OrdinalIgnoreCase)
    $rows = [Collections.Generic.List[string]]::new()
    foreach ($path in $paths) {
        $item = [IO.FileInfo]::new($path)
        $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
        $rows.Add("$($item.Name)`0$($item.Length)`0$hash")
    }
    [string[]]$orderedRows = $rows.ToArray()
    [Array]::Sort($orderedRows, [StringComparer]::Ordinal)
    $inventoryBytes = [Text.Encoding]::UTF8.GetBytes(($orderedRows -join "`n"))
    try {
        $inventorySha256 = [Convert]::ToHexString(
            [Security.Cryptography.SHA256]::HashData($inventoryBytes)
        ).ToLowerInvariant()
    }
    finally {
        [Array]::Clear($inventoryBytes, 0, $inventoryBytes.Length)
    }
    return [PSCustomObject]@{
        root = $canonicalRoot
        count = $orderedRows.Length
        sha256 = $inventorySha256
    }
}

function Assert-NoHostPathLeak {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string[]]$ForbiddenText
    )
    $bytes = [IO.File]::ReadAllBytes($Path)
    try {
        $latin1 = [Text.Encoding]::Latin1.GetString($bytes)
        $utf16Even = [Text.Encoding]::Unicode.GetString($bytes)
        $utf16Odd = if ($bytes.Length -gt 1) {
            [Text.Encoding]::Unicode.GetString($bytes, 1, $bytes.Length - 1)
        }
        else {
            ""
        }
        foreach ($needle in $ForbiddenText) {
            if ($latin1.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
                $utf16Even.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
                $utf16Odd.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
                throw "Compiled artifact leaks forbidden host/workspace text: $needle"
            }
        }
    }
    finally {
        [Array]::Clear($bytes, 0, $bytes.Length)
    }
}

$cargoSha256 = Assert-ExactFileSha256 $cargo $expectedCargoSha256 "Exact Rust Cargo"
$rustcSha256 = Assert-ExactFileSha256 $rustc $expectedRustcSha256 "Exact Rust compiler"
$rustfmtSha256 = Assert-ExactFileSha256 $rustfmt $expectedRustfmtSha256 "Exact rustfmt"
$cargoFmtSha256 = Assert-ExactFileSha256 $cargoFmt $expectedCargoFmtSha256 "Exact cargo-fmt"
$clippyDriverSha256 = Assert-ExactFileSha256 $clippyDriver $expectedClippyDriverSha256 "Exact Clippy driver"
$cargoClippySha256 = Assert-ExactFileSha256 $cargoClippy $expectedCargoClippySha256 "Exact cargo-clippy"
$nodeSha256 = Assert-ExactFileSha256 $node $expectedNodeSha256 "Exact Node executable"
$linkerSha256 = Assert-ExactFileSha256 $linker $expectedLinkerSha256 "Exact MSVC linker"
$dumpbinSha256 = Assert-ExactFileSha256 $dumpbin $expectedDumpbinSha256 "Exact MSVC dumpbin"
$msvcLibInventory = Get-ExactLibInventory $msvcLib
$windowsSdkUcrtLibInventory = Get-ExactLibInventory $windowsSdkUcrtLib
$windowsSdkUmLibInventory = Get-ExactLibInventory $windowsSdkUmLib
if ($msvcLibInventory.count -ne 76 -or $msvcLibInventory.sha256 -ne "51094871f56cb851b6c150e2e272e9ff3f30e6251128cb25d88b224283f8005b") {
    throw "MSVC x64 library inventory differs from the reviewed input"
}
if ($windowsSdkUcrtLibInventory.count -ne 8 -or $windowsSdkUcrtLibInventory.sha256 -ne "78a7e85e80bf826c95d75a5891dbc1da414706bde0f057985f40f7c48c95e86f") {
    throw "Windows SDK UCRT x64 library inventory differs from the reviewed input"
}
if ($windowsSdkUmLibInventory.count -ne 453 -or $windowsSdkUmLibInventory.sha256 -ne "137a3353fcb228371f8c2eec171917a80e6082b43aadaff828b3709dca1fdf0c") {
    throw "Windows SDK UM x64 library inventory differs from the reviewed input"
}
foreach ($directory in @($windowsSdkBin, $windowsSdkInclude)) {
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        throw "Exact reviewed Windows SDK directory is unavailable: $directory"
    }
}
foreach ($override in @("RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS")) {
    if (-not [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($override))) {
        throw "$override must be unset so committed reproducibility flags cannot be overridden"
    }
}
$cargoHome = Join-Path $env:USERPROFILE ".cargo"
foreach ($cargoConfig in @(
    (Join-Path $cargoHome "config"),
    (Join-Path $cargoHome "config.toml")
)) {
    if (Test-Path -LiteralPath $cargoConfig) {
        throw "User-level Cargo configuration is not permitted for the reviewed build: $cargoConfig"
    }
}
$boundEnvironmentKeys = @(
    "PATH",
    "LIB",
    "LIBPATH",
    "INCLUDE",
    "RUSTC",
    "RUSTDOC",
    "RUSTFMT",
    "RUSTFLAGS",
    "CARGO_ENCODED_RUSTFLAGS",
    "CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS",
    "RUSTC_WRAPPER",
    "RUSTC_WORKSPACE_WRAPPER",
    "CARGO_HOME",
    "CARGO_NET_OFFLINE",
    "CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER",
    "VCToolsInstallDir",
    "WindowsSdkDir",
    "WindowsSDKVersion",
    "UniversalCRTSdkDir",
    "UCRTVersion"
)
$previousEnvironment = @{}
foreach ($key in $boundEnvironmentKeys) {
    $previousEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
}
$system32 = Join-Path $env:SystemRoot "System32"
$env:PATH = @(
    $toolchainBin,
    $msvcBin,
    $windowsSdkBin,
    (Split-Path -Parent $node),
    $system32,
    $env:SystemRoot
) -join ";"
$env:LIB = @($msvcLib, $windowsSdkUcrtLib, $windowsSdkUmLib) -join ";"
$env:LIBPATH = ""
$env:INCLUDE = @(
    (Join-Path $msvcRoot "include"),
    (Join-Path $windowsSdkInclude "ucrt"),
    (Join-Path $windowsSdkInclude "shared"),
    (Join-Path $windowsSdkInclude "um"),
    (Join-Path $windowsSdkInclude "winrt"),
    (Join-Path $windowsSdkInclude "cppwinrt")
) -join ";"
$env:RUSTC = $rustc
$env:RUSTDOC = Join-Path $toolchainBin "rustdoc.exe"
$env:RUSTFMT = $rustfmt
$rustFlagParts = @(
    "-C",
    "target-feature=+crt-static",
    "-C",
    "link-arg=/Brepro",
    "-C",
    "link-arg=/PDBALTPATH:grand_hall_t554_runtime_inspector.pdb",
    "--remap-path-prefix=$env:USERPROFILE=/venviewer/host-user",
    "--remap-path-prefix=$($env:USERPROFILE.Replace('\', '/'))=/venviewer/host-user",
    "--remap-path-prefix=$cargoHome=/venviewer/tooling/cargo-home",
    "--remap-path-prefix=$($cargoHome.Replace('\', '/'))=/venviewer/tooling/cargo-home",
    "--remap-path-prefix=$crateRoot=/venviewer/source/grand-hall-t554-runtime-inspector",
    "--remap-path-prefix=$($crateRoot.Replace('\', '/'))=/venviewer/source/grand-hall-t554-runtime-inspector"
)
$env:RUSTFLAGS = $null
$env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS = $null
$env:CARGO_ENCODED_RUSTFLAGS = $rustFlagParts -join [char]0x1f
$env:RUSTC_WRAPPER = ""
$env:RUSTC_WORKSPACE_WRAPPER = ""
$env:CARGO_HOME = $cargoHome
$env:CARGO_NET_OFFLINE = "true"
$env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = $linker
$env:VCToolsInstallDir = "$msvcRoot\"
$env:WindowsSdkDir = "$windowsSdkRoot\"
$env:WindowsSDKVersion = "$expectedWindowsSdkVersion\"
$env:UniversalCRTSdkDir = "$windowsSdkRoot\"
$env:UCRTVersion = $expectedWindowsSdkVersion

Push-Location $crateRoot
try {
    if ((& $rustc --version) -ne $expectedRustc) {
        throw "rustc must exactly match $expectedRustc"
    }
    if ((& $cargo --version) -ne $expectedCargo) {
        throw "cargo must exactly match $expectedCargo"
    }
    if ((& $node -p "process.version") -ne $expectedNode) {
        throw "Node must exactly match $expectedNode"
    }
    if ((& $node -p "process.platform + '/' + process.arch") -ne "win32/x64") {
        throw "Node must be Windows x64"
    }

    & $cargo fmt --all -- --check
    & $cargo test --frozen --target $targetTriple
    & $cargo clippy --frozen --target $targetTriple --all-targets -- -D warnings

    New-Item -ItemType Directory -Path $reproRoot | Out-Null
    $targetA = Join-Path $reproRoot "build-a"
    $targetB = Join-Path $reproRoot "build-b"
    $previousTargetDirectory = $env:CARGO_TARGET_DIR
    try {
        $env:CARGO_TARGET_DIR = $targetA
        & $cargo build --frozen --release --target $targetTriple
        $env:CARGO_TARGET_DIR = $targetB
        & $cargo build --frozen --release --target $targetTriple
    }
    finally {
        $env:CARGO_TARGET_DIR = $previousTargetDirectory
    }

    $artifactA = Join-Path $targetA "$targetTriple\release\grand_hall_t554_runtime_inspector.dll"
    $artifactB = Join-Path $targetB "$targetTriple\release\grand_hall_t554_runtime_inspector.dll"
    $hashA = (Get-FileHash -LiteralPath $artifactA -Algorithm SHA256).Hash.ToLowerInvariant()
    $hashB = (Get-FileHash -LiteralPath $artifactB -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hashA -ne $hashB) {
        throw "Two clean release builds were not byte-identical: $hashA != $hashB"
    }
    $forbiddenArtifactRoots = @(
        "C:\Users",
        "C:/Users",
        "blake",
        "omnitwin2",
        ".cargo\registry",
        ".cargo/registry",
        $crateRoot,
        $cargoHome,
        $env:USERPROFILE,
        $toolchainBin,
        $node,
        $msvcRoot,
        $msvcBin,
        $linker,
        $dumpbin,
        $windowsSdkRoot,
        $windowsSdkBin,
        $windowsSdkInclude,
        $windowsSdkUcrtLib,
        $windowsSdkUmLib,
        $env:ProgramFiles,
        $programFilesX86,
        $env:SystemRoot,
        $temporaryBase,
        $reproRoot,
        "Microsoft Visual Studio",
        "Windows Kits",
        ".rustup",
        "AppData"
    )
    $forbiddenArtifactText = @(
        foreach ($entry in $forbiddenArtifactRoots) {
            if (-not [string]::IsNullOrWhiteSpace($entry)) {
                $entry
                $entry.Replace('\', '/')
            }
        }
    )
    Assert-NoHostPathLeak $artifactA $forbiddenArtifactText
    Assert-NoHostPathLeak $artifactB $forbiddenArtifactText

    $peInspection = (& $dumpbin /headers /dependents /exports $artifactA) -join "`n"
    if ($peInspection -notmatch '(?m)^\s*8664 machine \(x64\)\s*$') {
        throw "Release artifact is not an x64 PE image"
    }
    if ($peInspection -notmatch '(?m)^\s*1 number of functions\s*$' -or
        $peInspection -notmatch '(?m)^\s*1 number of names\s*$' -or
        $peInspection -notmatch '(?m)^\s*1\s+0\s+[0-9A-F]+\s+napi_register_module_v1\b') {
        throw "Release artifact does not expose exactly napi_register_module_v1"
    }
    $dependencies = [regex]::Matches(
        $peInspection,
        '(?mi)^\s+([a-z0-9_.-]+\.dll)\s*$'
    ) | ForEach-Object { $_.Groups[1].Value.ToLowerInvariant() } | Sort-Object -Unique
    $expectedDependencies = @(
        "api-ms-win-core-synch-l1-2-0.dll",
        "kernel32.dll",
        "ntdll.dll",
        "psapi.dll"
    ) | Sort-Object
    if (($dependencies -join "`n") -ne ($expectedDependencies -join "`n")) {
        throw "Unexpected PE dependency set: $($dependencies -join ', ')"
    }

    [IO.File]::Copy($artifactA, $temporaryDestination, $false)
    if ((Get-FileHash -LiteralPath $temporaryDestination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hashA) {
        throw "Temporary publication copy does not match the clean build"
    }
    Move-Item -LiteralPath $temporaryDestination -Destination $destination -Force

    try {
        & $node --expose-gc (Join-Path $crateRoot "probe.mjs") $destination $secondCopy
    }
    finally {
        Remove-Item -LiteralPath $secondCopy -Force -ErrorAction SilentlyContinue
    }

    [PSCustomObject]@{
        artifact = $destination
        bytes = (Get-Item -LiteralPath $destination).Length
        cleanBuildSha256 = $hashA
        cleanBuildsMatched = $true
        node = $expectedNode
        nodePath = $node
        nodeSha256 = $nodeSha256
        cargo = $expectedCargo
        cargoPath = $cargo
        cargoSha256 = $cargoSha256
        rustc = $expectedRustc
        rustcPath = $rustc
        rustcSha256 = $rustcSha256
        rustfmtSha256 = $rustfmtSha256
        cargoFmtSha256 = $cargoFmtSha256
        clippyDriverSha256 = $clippyDriverSha256
        cargoClippySha256 = $cargoClippySha256
        target = $targetTriple
        msvcTools = $expectedMsvcVersion
        linkerPath = $linker
        linkerSha256 = $linkerSha256
        dumpbinPath = $dumpbin
        dumpbinSha256 = $dumpbinSha256
        windowsSdk = $expectedWindowsSdkVersion
        msvcLibInventory = $msvcLibInventory
        windowsSdkUcrtLibInventory = $windowsSdkUcrtLibInventory
        windowsSdkUmLibInventory = $windowsSdkUmLibInventory
        dependencies = $dependencies
    } | ConvertTo-Json -Compress
}
finally {
    if (Test-Path -LiteralPath $temporaryDestination -PathType Leaf) {
        Remove-Item -LiteralPath $temporaryDestination -Force
    }
    $resolvedReproRoot = [IO.Path]::GetFullPath($reproRoot)
    if (Test-Path -LiteralPath $resolvedReproRoot -PathType Container) {
        if (-not $resolvedReproRoot.StartsWith("$temporaryBase\t554-runtime-inspector-repro-", [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to clean unexpected reproducibility directory: $resolvedReproRoot"
        }
        Remove-Item -LiteralPath $resolvedReproRoot -Recurse -Force
    }
    foreach ($key in $boundEnvironmentKeys) {
        [Environment]::SetEnvironmentVariable(
            $key,
            $previousEnvironment[$key],
            "Process"
        )
    }
    Pop-Location
}
