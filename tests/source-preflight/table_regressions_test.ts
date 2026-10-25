import { runTableCaptionRulesTests } from './table_caption_rules_test';
import { runTableCellContentTests } from './table_cell_content_test';
import { runTableReferenceRulesTests } from './table_reference_rules_test';
import { runTableRulesTests } from './table_rules_test';

runTableRulesTests();
runTableCaptionRulesTests();

runTableReferenceRulesTests();

runTableCellContentTests();
