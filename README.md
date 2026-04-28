# STO Report Generator

Этот проект предназначен для автоматической генерации отчетов в формате .docx из файлов Markdown, с соблюдением требований СТО (стандарт организации вуза).

## Установка
Требуется Node.js и uv (Python-зависимости).

npm install

## Использование
Сгенерировать отчет (на примере папки report_sem6 или modular_sample):
npm run build report_sem6 output.docx

Проверить сгенерированный файл:
npm run validate output.docx

(Если вы используете Windows и возникают проблемы с кодировкой консоли при валидации, установите переменную среды PYTHONUTF8=1).

## Распаковка (для отладки)
npm run unpack output.docx output_unpacked
