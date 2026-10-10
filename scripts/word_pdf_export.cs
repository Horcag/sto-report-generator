using System;
using System.Reflection;
using System.Runtime.InteropServices;

namespace WordAcceptance
{
    public sealed class PdfExportDiagnostic
    {
        public string Method { get; private set; }
        public bool OptimizeForImageQuality { get; private set; }
        public string Warning { get; private set; }
        public PdfExportDiagnostic(string method, bool highQuality, string warning)
        {
            Method = method;
            OptimizeForImageQuality = highQuality;
            Warning = warning;
        }
    }

    public static class PdfExporter
    {
        // Managed arguments avoid PowerShell-adapted COM argument mismatches.
        // Microsoft documents the v2 option separately from print optimization:
        // https://learn.microsoft.com/en-us/office/vba/api/word.document.exportasfixedformat2
        public static PdfExportDiagnostic Export(object document, string outputPath)
        {
            try
            {
                document.GetType().InvokeMember(
                    "ExportAsFixedFormat2", BindingFlags.InvokeMethod, null, document,
                    new object[] {
                        outputPath, 17, false, 0, 0, 1, 1, 0,
                        true, true, 1, true, true, false, true, Type.Missing
                    });
                return new PdfExportDiagnostic("ExportAsFixedFormat2", true, null);
            }
            catch (Exception error)
            {
                Exception cause = error is TargetInvocationException && error.InnerException != null
                    ? error.InnerException : error;
                COMException com = cause as COMException;
                bool unavailable = cause is MissingMethodException ||
                    (com != null && (com.ErrorCode == unchecked((int)0x80020003) ||
                                     com.ErrorCode == unchecked((int)0x80020006)));
                // Export errors are not capability failures: do not silently retry
                // them through an export path that may downsample pictures.
                if (!unavailable) throw;
            }
            document.GetType().InvokeMember(
                "ExportAsFixedFormat", BindingFlags.InvokeMethod, null, document,
                new object[] {
                    outputPath, 17, false, 0, 0, 1, 1, 0,
                    true, true, 1, true, true, false, Type.Missing
                });
            return new PdfExportDiagnostic("ExportAsFixedFormat", false,
                "This Word version lacks ExportAsFixedFormat2. PDF images may be downsampled; original image quality is unverified.");
        }
    }
}
