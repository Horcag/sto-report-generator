# Проверка атомов перечней и формул (#27)

<!-- cspell:words nonfinal -->

Источник требований: [special-atoms.csv](special-atoms.csv), строки F01–F50 и L01–L33. Это карта доказательств, а не заявление о полном соответствии внешним ГОСТ. Автоматические случаи находятся в `tests/source-preflight/run_source_preflight_tests.ts`; запуск: `npm run test:source`. Код проверок: `src/shared/lib/source-preflight/{formula-checker,list-checker}.ts`.

## Ручные процедуры

- **M1 — редактор формул.** Собрать документ с каждым видом формулы, распаковать DOCX и проверить наличие `m:oMath`/`m:oMathPara` вместо картинки или плоского текста; затем осмотреть результат в Word. Выполнять Word-приёмку только через `npm run accept:word -- <docx>`.
- **M2 — смысл и начертание.** Для конкретной формулы составить легенду: переменная, функция, цифра, единица, химический символ, греческая буква, вектор, матрица, текстовый фрагмент или индекс. В Word сравнить прямое/курсивное/полужирное начертание с ролью каждого символа, включая регистр и сохранность индексов. Одного исходного LaTeX для этого недостаточно.
- **M3 — геометрия формулы.** На странице Word/PDF осмотреть приоритет переноса (отношение, многоточие, плюс/минус, крест), запрет переноса по делению, повтор оператора, целостность базы с индексом/степенью и операторов с аргументами, высоту скобок и положение номера справа. При разрыве проверить именно итоговую строку, а не только исходный `\`.
- **M4 — математический смысл и текст.** Автор сверяет выбор inline/display, необходимость номера и ссылки, пунктуацию предложения, тип умножения (`\cdot`/`\times`/без знака), контекст многоточия и десятичное значение числа. Автоматические предупреждения показывают синтаксические подозрения; они не определяют семантику операндов.
- **M5 — отображение перечня.** Осмотреть Word/PDF: дефис первого уровня, строчные русские буквы второго, арабские цифры третьего, исключённые буквы, отступ каждого абзаца, маркер без лишней точки. По исходному тексту проверить вводную фразу, регистр, конечный знак, последний пункт, смешение маркеров и последовательность на каждом уровне.
- **M6 — структура пункта.** Разметить простой и сложный пункт, самостоятельное предложение и продолжение вводной фразы. У простого внутритекстового перечисления проверить запятую, у сложного — точку с запятой; для нижнего регистра в блочном перечне выбрать запятую/точку с запятой по сложности, для самостоятельного предложения — точку. Пунктуация не должна задаваться одной нормой для всех видов.
- **M7 — неподдерживаемый стиль.** Для перечисления с прописными буквами или римскими цифрами отдельно проверить вручную подготовленный Word-образец: маркер с точкой, прописное начало и точка в конце. Генератор пока не предоставляет отдельный уровень/тип для такого перечня; автоматическое соответствие не заявляется.

## Связь атомов с проверками

| Атом | Требование из аудита                                       | Тест                                                               | Ручная проверка |
| ---- | ---------------------------------------------------------- | ------------------------------------------------------------------ | --------------- |
| F01  | use formula editor                                         | —                                                                  | M1              |
| F02  | select Math style                                          | —                                                                  | M2              |
| F03  | select Function style                                      | `formula-bare-upright-function`                                    | M2              |
| F04  | select Variable style                                      | —                                                                  | M2              |
| F05  | select Greek-Symbol style                                  | —                                                                  | M2              |
| F06  | select Vector-Matrix style                                 | —                                                                  | M2              |
| F07  | select Text style for text fragment                        | —                                                                  | M2              |
| F08  | digits upright                                             | —                                                                  | M2              |
| F09  | decimal separator comma                                    | `formula-decimal-comma`                                            | M4              |
| F10  | Latin variable italic                                      | —                                                                  | M2              |
| F11  | unit letter italic                                         | —                                                                  | M2              |
| F12  | uppercase Greek upright                                    | —                                                                  | M2              |
| F13  | lowercase Greek italic                                     | —                                                                  | M2              |
| F14  | lowercase vector upright bold                              | —                                                                  | M2              |
| F15  | uppercase matrix upright bold                              | —                                                                  | M2              |
| F16  | ordinary function upright                                  | `formula-bare-upright-function`                                    | M2              |
| F17  | trigonometric function upright                             | `formula-bare-upright-function`                                    | M2              |
| F18  | temperature unit upright                                   | —                                                                  | M2              |
| F19  | chemical element upright                                   | —                                                                  | M2              |
| F20  | abbreviated subscript upright                              | —                                                                  | M2              |
| F21  | numeric subscript retained as index                        | —                                                                  | M2              |
| F22  | break first on relation sign                               | —                                                                  | M3              |
| F23  | break second on ellipsis                                   | —                                                                  | M3              |
| F24  | break third on plus/minus                                  | —                                                                  | M3              |
| F25  | break last on multiplication cross                         | —                                                                  | M3              |
| F26  | never break at division                                    | `formula-line-break-after-division`                                | M3              |
| F27  | repeat operator at next line                               | `formula-break-operator-repeat`                                    | M3              |
| F28  | do not separate subscript from base                        | —                                                                  | M3              |
| F29  | do not separate superscript from base                      | —                                                                  | M3              |
| F30  | do not separate integrand from integral                    | —                                                                  | M3              |
| F31  | do not separate expression from logarithm                  | —                                                                  | M3              |
| F32  | do not separate expression from sum/product                | —                                                                  | M3              |
| F33  | small non-independent formula inline                       | —                                                                  | M4              |
| F34  | important formula display                                  | —                                                                  | M4              |
| F35  | numbered formula display                                   | —                                                                  | M4              |
| F36  | long formula display                                       | —                                                                  | M4              |
| F37  | sum/product formula display                                | —                                                                  | M4              |
| F38  | number only formula referenced in text                     | `unused-equation-label`                                            | M4              |
| F39  | number enclosed in parentheses                             | —                                                                  | M4              |
| F40  | number at right page edge                                  | —                                                                  | M4              |
| F41  | consecutive display formulas comma/semicolon               | `consecutive-formula-punctuation`                                  | M4              |
| F42  | Russian punctuation around formula                         | —                                                                  | M4              |
| F43  | round brackets cover expression height                     | —                                                                  | M3              |
| F44  | square brackets cover expression height                    | —                                                                  | M3              |
| F45  | braces cover expression height                             | —                                                                  | M3              |
| F46  | mid-dot primary multiplication sign                        | `formula-scalar-cdot / formula-forbidden-raw-multiplication-token` | M4              |
| F47  | no dot between number and letter                           | `formula-number-letter-cdot`                                       | M4              |
| F48  | no dot with vector-matrix or parentheses/function argument | `formula-parenthesis-cdot / formula-vector-cdot`                   | M4              |
| F49  | cross only permitted product contexts                      | —                                                                  | M4              |
| F50  | ellipsis preceded/followed by operation signs              | `formula-forbidden-raw-token`                                      | M4              |
| L01  | top item hyphen                                            | —                                                                  | M5              |
| L02  | second level Russian lower letter parenthesis              | —                                                                  | M5              |
| L03  | exclude й                                                  | `forbidden-list-letter-й`                                          | M5              |
| L04  | exclude ё                                                  | `forbidden-list-letter`                                            | M5              |
| L05  | exclude з                                                  | `forbidden-list-letter-з`                                          | M5              |
| L06  | exclude о                                                  | `forbidden-list-letter-о`                                          | M5              |
| L07  | exclude ч                                                  | `forbidden-list-letter-ч`                                          | M5              |
| L08  | exclude ь                                                  | `forbidden-list-letter-ь`                                          | M5              |
| L09  | exclude ы                                                  | `forbidden-list-letter-ы`                                          | M5              |
| L10  | exclude ъ                                                  | `forbidden-list-letter-ъ`                                          | M5              |
| L11  | third level Arabic parenthesis                             | —                                                                  | M5              |
| L12  | no point after parenthesis                                 | `list-marker-extra-dot`                                            | M5              |
| L13  | every item paragraph indent                                | —                                                                  | M5              |
| L14  | lead-in sentence before list                               | `list-intro-punctuation`                                           | M5              |
| L15  | lead-in generalizing word                                  | —                                                                  | M5              |
| L16  | move trailing preposition into first item                  | `list-intro-trailing-preposition`                                  | M5              |
| L17  | colon after direct lead-in                                 | `list-intro-punctuation`                                           | M5              |
| L18  | full stop allowed after weak lead-in                       | `list-intro-punctuation`                                           | M5              |
| L19  | inline list uses comma for simple items                    | —                                                                  | M6              |
| L20  | inline list uses semicolon for complex items               | —                                                                  | M6              |
| L21  | uppercase-letter marker dot                                | —                                                                  | M7              |
| L22  | Roman marker dot                                           | —                                                                  | M7              |
| L23  | decimal marker dot                                         | `list-marker-sequence-gap`                                         | M5              |
| L24  | upper/dot item begins uppercase                            | `list-dotted-item-case`                                            | M5              |
| L25  | upper/dot item ends full stop                              | `list-dotted-item-punctuation`                                     | M5              |
| L26  | lower-letter parenthesis item begins lowercase             | `list-parenthesized-nonfinal-comma`                                | M6              |
| L27  | Arabic-parenthesis item begins lowercase                   | `list-parenthesized-nonfinal-comma`                                | M6              |
| L28  | hyphen item begins lowercase                               | `list-parenthesized-nonfinal-comma`                                | M6              |
| L29  | lower/simple nonfinal item comma                           | `list-parenthesized-nonfinal-comma`                                | M6              |
| L30  | lower/complex nonfinal item semicolon                      | `list-item-lowercase-punctuation`                                  | M6              |
| L31  | last item full stop                                        | `list-nested-final-item-period`                                    | M5              |
| L32  | marker style not mixed at level                            | `list-mixed-marker-style`                                          | M5              |
| L33  | number sequence consecutive                                | `list-marker-sequence-gap / list-russian-marker-sequence-gap`      | M5              |

## Границы доказательств

Зелёный `npm run test:source` доказывает перечисленные исходные проверки. Он не доказывает свойства OMML, Word-геометрию, смысл символов или поддержку прописных/римских маркеров. Процедуры M1–M7 являются явными ручными приёмочными проверками для отчёта, где соответствующий атом встречается; в этой задаче нет подготовленного эталонного DOCX и результата Word-приёмки по каждому такому случаю.
