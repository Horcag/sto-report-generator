export const paragraph = (
	text = 'Heading',
	properties = '<w:jc w:val="center"/>',
) => `<w:p><w:pPr>${properties}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
export const cell = (content = paragraph(), properties = '') =>
	`<w:tc><w:tcPr>${properties}</w:tcPr>${content}</w:tc>`;
export const row = (cells = cell() + cell(), properties = '<w:tblHeader/>') =>
	`<w:tr><w:trPr>${properties}</w:trPr>${cells}</w:tr>`;
export const table = (
	rows = row() +
		row(
			cell(paragraph('2025', '<w:jc w:val="right"/>')) +
				cell(paragraph('1.25', '<w:jc w:val="right"/>')),
			'',
		),
	properties = '',
	grid = '<w:gridCol w:w="1000"/><w:gridCol w:w="1000"/>',
) =>
	`<w:tbl><w:tblPr>${properties}</w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>`;
export const documentXml = (body: string) =>
	`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}</w:body></w:document>`;
export const style = (
	id: string,
	body: string,
	type = 'paragraph',
	extra = '',
) => `<w:style w:type="${type}" w:styleId="${id}" ${extra}>${body}</w:style>`;
