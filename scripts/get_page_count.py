import sys
import os
import win32com.client

def get_page_count(docx_path):
    abs_path = os.path.abspath(docx_path)
    if not os.path.exists(abs_path):
        print(f"Error: File not found - {abs_path}", file=sys.stderr)
        sys.exit(1)

    word = None
    doc = None
    try:
        word = win32com.client.Dispatch("Word.Application")
        word.Visible = False
        
        # Open document
        doc = word.Documents.Open(abs_path, ReadOnly=True)
        
        # Force repagination to ensure accuracy
        doc.Repaginate()
        
        # wdStatisticPages = 2
        page_count = doc.ComputeStatistics(2)
        print(page_count)
        
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        if doc is not None:
            doc.Close(False)
        if word is not None:
            word.Quit()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python get_page_count.py <path_to_docx>", file=sys.stderr)
        sys.exit(1)
    
    get_page_count(sys.argv[1])
