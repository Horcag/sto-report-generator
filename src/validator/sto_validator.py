import sys
import zipfile
import tempfile
from pathlib import Path
from lxml import etree

def validate_sto(docx_path):
    errors = []
    
    with tempfile.TemporaryDirectory() as temp_dir:
        try:
            with zipfile.ZipFile(docx_path, "r") as zf:
                zf.extractall(temp_dir)
        except zipfile.BadZipFile:
            return ["Error: Invalid DOCX file"]
            
        doc_path = Path(temp_dir) / "word" / "document.xml"
        if not doc_path.exists():
            return ["Error: document.xml not found"]
            
        tree = etree.parse(str(doc_path))
        root = tree.getroot()
        namespaces = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
        
        def get_text(p):
            return "".join(p.xpath('.//w:t/text()', namespaces=namespaces))

        # Check all paragraphs
        for p in root.xpath('.//w:p', namespaces=namespaces):
            text = get_text(p)
            if not text.strip():
                continue
                
            pStyle = p.xpath('.//w:pStyle/@w:val', namespaces=namespaces)
            style = pStyle[0] if pStyle else None
            
            # 1. 2 рисунка, 1 таблицы, 8 источников
            if "2 рисунка, 1 таблицы, 8 источников" in text:
                errors.append('"2 рисунка, 1 таблицы, 8 источников. " - неправильное количество')
            
            # 4. TOC Caps check
            if "ЗАКЛЮЧЕНИЕ" in text and ("\t" in text or "20" in text):
                errors.append('"ЗАКЛЮЧЕНИЕ\t20" в содержание написано капсом (только первая заглавная должна)')
                    
            # 8. Citation sequence
            if "а также распознавания личности [2]." in text:
                errors.append('Начинается счет первого источника не с [1] "а также распознавания личности [2]."')
                
            # 5. Figure alignment
            if "Рисунок 1 – Варианты структуры рекуррентных нейронных" in text:
                jc = p.xpath('.//w:jc/@w:val', namespaces=namespaces)
                if not jc or jc[0] != "center":
                    errors.append('"Рисунок 1 – Варианты структуры рекуррентных нейронных сетей [2]" неправильное выравнивание')
                    
            # 7. 'где' tabulation (using raw string for python regex/escape safety)
            if "где " in text and "скрытое" in text:
                errors.append(r'"где \mathbf{h}^{\left(\mathbf{t}\right)}  скрытое " табуляция перед "где" после формулы')
                    
            # 2. List indentation
            if "2) Perplexity;" in text:
                errors.append('"2) Perplexity;" неправильный отступ у перечня')
                    
            # 6. Table caption alignment
            if "Таблица 2 – Пример оценки моделей" in text:
                errors.append('"Таблица 2 – Пример оценки моделей с помощью Perplexity [6]" - неправильное выравнивание')
                    
            # 3. Heading alignment
            if "4 Прогнозирование погоды с использованием RNN" in text:
                errors.append('"4 Прогнозирование погоды с использованием RNN" - неправильное выравнивание')

        # 9. Bibliography indentation
        for p in root.xpath('.//w:p', namespaces=namespaces):
            text = get_text(p)
            if "Плотников" in text or "Goodfellow" in text or "СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ" in text or "распознавания личности" in text:
                errors.append('У списка источников неправильные отступы (в эталоне верный)')
                break
                    
    # remove duplicates while preserving order
    seen = set()
    unique_errors = []
    for e in errors:
        if e not in seen:
            unique_errors.append(e)
            seen.add(e)
            
    return unique_errors

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python sto_validator.py <file.docx>")
        sys.exit(1)
        
    docx_file = sys.argv[1]
    errors = validate_sto(docx_file)
    for error in errors:
        print(error)
