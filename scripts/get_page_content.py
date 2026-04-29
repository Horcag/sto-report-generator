import sys
import os
import win32com.client

def get_page_content(docx_path, page_num):
    abs_path = os.path.abspath(docx_path)
    if not os.path.exists(abs_path):
        print(f"Error: File not found - {abs_path}", file=sys.stderr)
        sys.exit(1)

    word = None
    doc = None
    try:
        word = win32com.client.Dispatch("Word.Application")
        word.Visible = False
        
        doc = word.Documents.Open(abs_path, ReadOnly=True)
        doc.Repaginate()
        
        # Go to the specific page
        # wdGoToPage = 1, wdGoToAbsolute = 1
        word.Selection.GoTo(What=1, Which=1, Count=page_num)
        
        # Select the whole page by setting a bookmark to the predefined "\page" bookmark
        page_range = doc.Bookmarks("\\page").Range
        text = page_range.Text
        print(text)
        
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        if doc is not None:
            doc.Close(False)
        if word is not None:
            word.Quit()

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python get_page_content.py <path_to_docx> <page_number>", file=sys.stderr)
        sys.exit(1)
    
    get_page_content(sys.argv[1], int(sys.argv[2]))
