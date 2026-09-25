import fs from 'node:fs';
import path from 'node:path';

/** Resolve both documented report-relative and scaffolded workspace-relative paths. */
export function resolveBibliographyPath(
	rawPath: string,
	sourceDir: string,
	cwd: string,
): string {
	if (path.isAbsolute(rawPath)) return path.normalize(rawPath);

	const fromSource = path.resolve(sourceDir, rawPath);
	const fromWorkspace = path.resolve(cwd, rawPath);
	if (fromSource === fromWorkspace) return fromSource;

	const sourceExists = fs.existsSync(fromSource);
	const workspaceExists = fs.existsSync(fromWorkspace);
	if (sourceExists && workspaceExists) {
		throw new Error(
			`Bibliography path "${rawPath}" is ambiguous: both ${fromSource} and ${fromWorkspace} exist. Use an unambiguous path.`,
		);
	}
	if (sourceExists) return fromSource;
	if (workspaceExists) return fromWorkspace;
	return fromSource;
}
