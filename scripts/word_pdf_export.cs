using System;
using System.Reflection;

namespace WordAcceptance
{
    public static class PdfExporter
    {
        // Keep the COM argument array inside managed code. On the tested Office
        // installation, PowerShell dispatch hung or returned DISP_E_TYPEMISMATCH,
        // while this typed call exported the same document successfully.
        public static void Export(object document, string outputPath)
        {
            document.GetType().InvokeMember(
                "ExportAsFixedFormat",
                BindingFlags.InvokeMethod,
                null,
                document,
                new object[] {
                    outputPath, 17, false, 0, 0, 1, 1, 0,
                    true, true, 1, true, true, false, Type.Missing
                });
        }
    }
}
