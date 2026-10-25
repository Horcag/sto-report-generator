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
            return Export(document, outputPath, "original");
        }

        public static PdfExportDiagnostic Export(object document, string outputPath, string quality)
        {
            if (quality != "original" && quality != "print" && quality != "screen")
                throw new ArgumentException("PDF image quality must be original, print or screen.");
            bool original = quality == "original";
            string method = original ? "ExportAsFixedFormat2" : "ExportAsFixedFormat";
            object[] args = original
                ? new object[] { outputPath, 17, false, 0, 0, 1, 1, 0,
                    true, true, 1, true, true, false, true, Type.Missing }
                : new object[] { outputPath, 17, false, quality == "screen" ? 1 : 0,
                    0, 1, 1, 0, true, true, 1, true, true, false, Type.Missing };
            string[] names = original
                ? new string[] { "OutputFileName", "ExportFormat", "OpenAfterExport", "OptimizeFor",
                    "Range", "From", "To", "Item", "IncludeDocProps", "KeepIRM", "CreateBookmarks",
                    "DocStructureTags", "BitmapMissingFonts", "UseISO19005_1", "OptimizeForImageQuality", "FixedFormatExtClassPtr" }
                : new string[] { "OutputFileName", "ExportFormat", "OpenAfterExport", "OptimizeFor",
                    "Range", "From", "To", "Item", "IncludeDocProps", "KeepIRM", "CreateBookmarks",
                    "DocStructureTags", "BitmapMissingFonts", "UseISO19005_1", "FixedFormatExtClassPtr" };
            try
            {
                // Bind every argument by its COM name. Do not rely on optional-argument
                // positions: Word versions/type libraries can disagree with VBA docs.
                document.GetType().InvokeMember(method, BindingFlags.InvokeMethod | BindingFlags.OptionalParamBinding, null,
                    document, args, null, null, names);
            }
            catch (Exception error)
            {
                Exception cause = error is TargetInvocationException && error.InnerException != null
                    ? error.InnerException : error;
                COMException com = cause as COMException;
                bool unavailable = cause is MissingMethodException ||
                    (com != null && (com.ErrorCode == unchecked((int)0x80020003) ||
                                     com.ErrorCode == unchecked((int)0x80020006)));
                if (original && unavailable)
                    throw new NotSupportedException("Word cannot export original image quality. " +
                        "Update Word or explicitly select --pdf-image-quality print (may downsample images).", cause);
                throw;
            }
            return new PdfExportDiagnostic(method, original, original ? null :
                "Word may downsample images in this explicit size-optimized mode; inspect the PDF.");
        }
    }
}
