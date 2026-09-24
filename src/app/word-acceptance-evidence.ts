import { createHash } from 'node:crypto';
import fs from 'node:fs';

export function getFileEvidence(filePath: string): {
	exists: boolean;
	path: string;
	sha256?: string;
	sizeBytes?: number;
} {
	if (!fs.existsSync(filePath)) return { exists: false, path: filePath };
	const bytes = fs.readFileSync(filePath);
	return {
		exists: true,
		path: filePath,
		sha256: createHash('sha256').update(bytes).digest('hex'),
		sizeBytes: bytes.length,
	};
}
