import os from 'node:os';

function currentPlatformLabel(): string {
	const release = os.release().toLowerCase();
	if (
		process.platform === 'linux' &&
		(release.includes('microsoft') || release.includes('wsl'))
	) {
		return 'Linux/WSL';
	}
	if (process.platform === 'win32') {
		return 'Windows';
	}
	if (process.platform === 'darwin') {
		return 'macOS';
	}
	return process.platform;
}

export function runDoctor(): void {
	const platform = currentPlatformLabel();
	console.log('STO doctor');
	console.log('Portable renderer: available');
	console.log(
		'  Builds and validates DOCX with Node/OpenXML; PDF pagination is not authoritative.',
	);
	if (process.platform === 'win32') {
		console.log('Word renderer: optional');
		console.log(
			'  Requires Microsoft Word and pywin32 at post-build runtime. Run --renderer word to verify COM access on a real document.',
		);
		console.log(
			'Word acceptance: available when Microsoft Word is installed.',
		);
		return;
	}
	if (platform === 'Linux/WSL') {
		console.log('Word renderer: unavailable');
		console.log(
			'  The legacy full post-build requires native Windows Python and pywin32.',
		);
		console.log(
			'Word acceptance: available when Windows PowerShell and Microsoft Word are installed on the host.',
		);
		console.log(
			'  Run npm run accept:word -- <docx> to create an accepted DOCX/PDF and JSON manifest from WSL.',
		);
		return;
	}
	console.log('Word renderer: unavailable');
	console.log(
		`  Current platform is ${platform}. Use --renderer portable here, or run --renderer word on native Windows with Microsoft Word and pywin32 installed.`,
	);
	console.log(
		'Word acceptance: unavailable. Run accept-word from WSL connected to a Windows Word host or from native Windows.',
	);
}
