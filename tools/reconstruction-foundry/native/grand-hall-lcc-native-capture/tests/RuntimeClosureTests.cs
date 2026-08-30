using System;
using System.IO;
using System.Reflection;
using Venviewer.NativeCapture;

internal static class RuntimeClosureTests
{
    private static int Main(string[] args)
    {
        try
        {
            if (args.Length != 4)
            {
                throw new ArgumentException(
                    "Expected editor root, managed root, closure lock path, and closure lock SHA-256.");
            }

            string managedRoot = CapturePolicy.NormalizePath(args[1]);
            AppDomain.CurrentDomain.AssemblyResolve += delegate(object sender, ResolveEventArgs eventArgs)
            {
                string fileName = new AssemblyName(eventArgs.Name).Name + ".dll";
                string path = Path.Combine(managedRoot, fileName);
                return File.Exists(path) ? Assembly.LoadFrom(path) : null;
            };

            RuntimeClosureReceipt receipt = RuntimeClosurePolicy.Verify(args[0], args[2], args[3]);
            if (!receipt.boundedInventoryVerified || receipt.memberCount < 890 ||
                receipt.totalByteLength < 1400000000L || receipt.enabledStockModuleIds.Length != 10)
            {
                throw new InvalidOperationException("The bounded runtime closure receipt is incomplete.");
            }

            Console.WriteLine(
                "PASS: runtime closure " + receipt.memberCount + " files / " +
                receipt.totalByteLength + " bytes / " + receipt.inventorySha256);
            return 0;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine("FAIL: " + exception);
            return 1;
        }
    }
}
