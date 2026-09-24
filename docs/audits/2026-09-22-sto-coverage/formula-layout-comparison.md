# Размещение формулы и номера в Word

Проверка 24 сентября 2026 года сравнивает две копии одного отчёта. Исходная
копия `table-long.docx` создана генератором. В `tab-long.docx` только формульные
таблицы заменены абзацами с двумя табуляторами и стилем `MTDisplayEquation`;
все остальные части отчёта одинаковы. Воспроизводимый преобразователь:
[`probes/formula-tab-candidate.py`](probes/formula-tab-candidate.py). Обе копии
прошли `npm run accept:word -- <docx>` последовательно; манифесты находятся в
`.agent-work/formula-experiment/` и подтверждают 8 стабильных страниц, экспорт
PDF и очистку процесса Word.

Исходный корпус воспроизводится из `example/` добавлением
[`probes/formula-long-snippet.md`](probes/formula-long-snippet.md) в конец
`10_main.md`. Из корня репозитория:

```sh
mkdir -p .agent-work/formula-experiment
cp -a example .agent-work/formula-experiment/source
cat docs/audits/2026-09-22-sto-coverage/probes/formula-long-snippet.md >> .agent-work/formula-experiment/source/10_main.md
npm run build -- .agent-work/formula-experiment/source .agent-work/formula-experiment/table-long.docx
python3 docs/audits/2026-09-22-sto-coverage/probes/formula-tab-candidate.py .agent-work/formula-experiment/table-long.docx .agent-work/formula-experiment/tab-long.docx
npm run accept:word -- .agent-work/formula-experiment/table-long.docx
npm run accept:word -- .agent-work/formula-experiment/tab-long.docx
```

| Проверка                                      | Таблица генератора                                            | Абзац `MTDisplayEquation` с табуляторами                                         |
| --------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Номер длинной формулы `(2)` в PDF, страница 6 | x=536–552 pt, y=298–313 pt; у правого поля и на первой строке | x=311–327 pt, y=159–174 pt; ушёл на вторую строку внутрь формулы                 |
| Перенос длинной формулы                       | Три строки, номер остаётся справа от первой                   | Две строки, номер следует за последним слагаемым                                 |
| Пагинация                                     | Рисунок и формула на странице 6                               | Рисунок переместился на страницу 5, формула осталась на странице 6               |
| `validate-docx` на исходном DOCX              | Все проверки прошли                                           | `Tab Characters` не пройдена: проверка DOCX запрещает ручные табуляторы в тексте |

Координаты сняты с PDF через PyMuPDF (`page.get_text('words')`); обе страницы 6
осмотрены как изображения. Проверка короткой формулы также дала по 8 страниц,
но не обнаружила проблему: для выбора механизма важен перенос длинного выражения.
Попытка с `\\substack` исключена из сравнения, так как текущий конвертер вывел
в Word неподдерживаемый знак вместо содержимого.

**Решение:** оставить формульную layout-таблицу. Она сохраняет номер у правого
поля и проходит действующий проверка DOCX. Переход на `MTDisplayEquation` требует
отдельного способа удержать номер на первой строке длинной формулы и явного
исключения формульных табуляторов из запрета проверка DOCXа. Само наличие стиля в
DOTM не доказывает пригодность прямой замены таблицы.
