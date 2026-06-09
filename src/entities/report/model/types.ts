export interface ReportMetadata {
	organizationLines?: string[];
	department: string;
	subdepartment: string;
	reportType: string;
	degree: string;
	semester: number;
	specialtyCode: string;
	specialtyName: string;
	profileName: string;
	studentName: string;
	groupNumber: string;
	topic: string;
	topicPrefix?: string;
	supervisorName: string;
	supervisorTitle: string;
	supervisorRole?: string;
	gradeLine?: string;
	grade?: string;
	city: string;
	year: number;
	hideSignatures?: boolean;
}
