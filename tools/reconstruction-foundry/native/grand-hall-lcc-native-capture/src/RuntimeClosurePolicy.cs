using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using Newtonsoft.Json;

namespace Venviewer.NativeCapture
{
    internal sealed class RuntimeClosureLockDocument
    {
        public string schemaVersion { get; set; }
        public string sourceEditorRoot { get; set; }
        public string selectionPolicy { get; set; }
        public string[] excludedRelativeRoots { get; set; }
        public string[] enabledStockModuleIds { get; set; }
        public string[] enabledStockModuleRoots { get; set; }
        public string inventorySha256 { get; set; }
        public int memberCount { get; set; }
        public long totalByteLength { get; set; }
        public List<RuntimeClosureLockMember> members { get; set; }
        public string[] limitations { get; set; }
    }

    internal sealed class RuntimeClosureLockMember
    {
        public string relativePath { get; set; }
        public long byteLength { get; set; }
        public string sha256 { get; set; }
    }

    internal static class RuntimeClosurePolicy
    {
        internal const string SchemaVersion =
            "venviewer.grand-hall.lcc-native-runtime-closure-lock.v1";
        internal const string SelectionPolicy =
            "Every regular file recursively beneath the editor root, excluding only the first-party module directory.";
        internal const string ExcludedModuleRelativeRoot = @"Modules\Venviewer Native Capture";

        internal static RuntimeClosureReceipt Verify(
            string editorRoot,
            string lockPath,
            string expectedLockSha256)
        {
            string root = CapturePolicy.NormalizePath(editorRoot);
            string normalizedLockPath = CapturePolicy.NormalizePath(lockPath);
            string lockSha256 = CapturePolicy.Sha256File(normalizedLockPath);
            if (!String.Equals(lockSha256, expectedLockSha256, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("The runtime-closure lock file hash drifted.");
            }

            RuntimeClosureLockDocument document = JsonConvert.DeserializeObject<RuntimeClosureLockDocument>(
                File.ReadAllText(normalizedLockPath));
            RequireValidDocument(document);
            List<string> actualFiles = EnumerateBoundedFiles(root);
            RequireExactRelativeInventory(root, actualFiles, document.members);

            List<RuntimeClosureMemberReceipt> receipts = SnapshotMembers(root, document.members);
            string inventorySha256 = InventorySha256(receipts);
            if (!String.Equals(inventorySha256, document.inventorySha256, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    "The disposable editor runtime-closure inventory digest drifted. Expected " +
                    document.inventorySha256 + " but found " + inventorySha256 + ".");
            }

            return new RuntimeClosureReceipt
            {
                lockPath = normalizedLockPath,
                lockSha256 = lockSha256,
                selectionPolicy = document.selectionPolicy,
                excludedRelativeRoots = document.excludedRelativeRoots,
                enabledStockModuleIds = document.enabledStockModuleIds,
                enabledStockModuleRoots = document.enabledStockModuleRoots,
                inventorySha256 = inventorySha256,
                memberCount = receipts.Count,
                totalByteLength = receipts.Sum(item => item.byteLength),
                members = receipts,
                limitations = document.limitations,
                boundedInventoryVerified = true
            };
        }

        private static void RequireValidDocument(RuntimeClosureLockDocument document)
        {
            if (document == null ||
                !String.Equals(document.schemaVersion, SchemaVersion, StringComparison.Ordinal) ||
                !String.Equals(document.selectionPolicy, SelectionPolicy, StringComparison.Ordinal) ||
                document.members == null || document.members.Count == 0 ||
                document.limitations == null || document.limitations.Length == 0)
            {
                throw new InvalidDataException("The runtime-closure lock document is incomplete or has an unknown schema.");
            }

            string sourceRoot = CapturePolicy.NormalizePath(document.sourceEditorRoot);
            if (!String.Equals(sourceRoot, @"F:\LccStudio\lcceditor", StringComparison.OrdinalIgnoreCase) ||
                document.excludedRelativeRoots == null || document.excludedRelativeRoots.Length != 1 ||
                document.enabledStockModuleIds == null || document.enabledStockModuleIds.Length == 0 ||
                document.enabledStockModuleRoots == null ||
                document.enabledStockModuleRoots.Length != document.enabledStockModuleIds.Length ||
                !String.Equals(
                    document.excludedRelativeRoots[0],
                    ExcludedModuleRelativeRoot,
                    StringComparison.Ordinal))
            {
                throw new InvalidDataException("The runtime-closure selection boundary drifted.");
            }

            if (document.memberCount != document.members.Count ||
                document.totalByteLength != document.members.Sum(item => item.byteLength))
            {
                throw new InvalidDataException("The runtime-closure lock totals are invalid.");
            }

            CapturePolicy.RequireSha256(document.inventorySha256, "runtime closure inventory SHA");
        }

        private static List<string> EnumerateBoundedFiles(string root)
        {
            var files = new List<string>();
            var pending = new Stack<DirectoryInfo>();
            pending.Push(new DirectoryInfo(root));
            while (pending.Count > 0)
            {
                DirectoryInfo directory = pending.Pop();
                foreach (FileSystemInfo entry in directory.GetFileSystemInfos())
                {
                    if ((entry.Attributes & FileAttributes.ReparsePoint) != 0)
                    {
                        throw new InvalidOperationException(
                            "The disposable editor closure contains a reparse point: " + entry.FullName);
                    }

                    var childDirectory = entry as DirectoryInfo;
                    if (childDirectory != null)
                    {
                        string relativeDirectory = CapturePolicy.RelativePathUnderRoot(root, childDirectory.FullName);
                        if (!String.Equals(
                            relativeDirectory,
                            ExcludedModuleRelativeRoot,
                            StringComparison.OrdinalIgnoreCase))
                        {
                            pending.Push(childDirectory);
                        }
                    }
                    else if (entry is FileInfo)
                    {
                        files.Add(CapturePolicy.NormalizePath(entry.FullName));
                    }
                }
            }

            files.Sort(StringComparer.Ordinal);
            return files;
        }

        private static void RequireExactRelativeInventory(
            string root,
            IList<string> actualFiles,
            IList<RuntimeClosureLockMember> expectedMembers)
        {
            string[] actual = actualFiles
                .Select(path => CapturePolicy.RelativePathUnderRoot(root, path))
                .OrderBy(path => path, StringComparer.Ordinal)
                .ToArray();
            string[] expected = expectedMembers
                .Select(RequireSafeRelativePath)
                .OrderBy(path => path, StringComparer.Ordinal)
                .ToArray();
            if (expected.Distinct(StringComparer.OrdinalIgnoreCase).Count() != expected.Length ||
                !actual.SequenceEqual(expected, StringComparer.Ordinal))
            {
                throw new InvalidOperationException(
                    "The disposable editor file inventory differs from the bounded runtime-closure lock.");
            }
        }

        private static string RequireSafeRelativePath(RuntimeClosureLockMember member)
        {
            if (member == null || String.IsNullOrWhiteSpace(member.relativePath) ||
                Path.IsPathRooted(member.relativePath) || member.relativePath.Contains("..") ||
                member.byteLength < 0)
            {
                throw new InvalidDataException("The runtime-closure lock contains an unsafe member.");
            }

            CapturePolicy.RequireSha256(member.sha256, "runtime closure member SHA");
            return member.relativePath;
        }

        private static List<RuntimeClosureMemberReceipt> SnapshotMembers(
            string root,
            IEnumerable<RuntimeClosureLockMember> members)
        {
            var receipts = new List<RuntimeClosureMemberReceipt>();
            foreach (RuntimeClosureLockMember member in members.OrderBy(
                item => item.relativePath,
                StringComparer.Ordinal))
            {
                string path = CapturePolicy.NormalizePath(Path.Combine(root, member.relativePath));
                var info = new FileInfo(path);
                if (!info.Exists || info.Length != member.byteLength)
                {
                    throw new InvalidOperationException(
                        "Runtime-closure member length drifted: " + member.relativePath);
                }

                string sha256 = CapturePolicy.Sha256File(path);
                if (!String.Equals(sha256, member.sha256, StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidOperationException(
                        "Runtime-closure member hash drifted: " + member.relativePath);
                }

                receipts.Add(new RuntimeClosureMemberReceipt
                {
                    relativePath = member.relativePath,
                    byteLength = info.Length,
                    sha256 = sha256
                });
            }

            return receipts;
        }

        private static string InventorySha256(IEnumerable<RuntimeClosureMemberReceipt> receipts)
        {
            var builder = new StringBuilder();
            foreach (RuntimeClosureMemberReceipt receipt in receipts.OrderBy(
                item => item.relativePath,
                StringComparer.Ordinal))
            {
                builder.Append(receipt.relativePath);
                builder.Append('|');
                builder.Append(receipt.byteLength.ToString(CultureInfo.InvariantCulture));
                builder.Append('|');
                builder.Append(receipt.sha256.ToUpperInvariant());
                builder.Append('\n');
            }

            return CapturePolicy.Sha256Text(builder.ToString());
        }
    }
}
