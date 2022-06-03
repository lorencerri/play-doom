import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { UltimateTextToImage } from 'ultimate-text-to-image';
import { exec } from 'child_process';

@Injectable()
export class AppService {
	getHello(): string {
		return 'Hello World!';
	}

	validateNamespace(namespace: string): string {
		if (namespace.length === 0) return "Namespace cannot be empty.";
		if (namespace.length > 32) return "Namespace cannot be longer than 32 characters.";
		if (!/^[a-zA-Z0-9_]+$/.test(namespace)) return "Invalid characters in namespace.";
		return "";
	}

	validateInput(input: string): string {
		if (input.length === 0) return "Input cannot be empty.";
		if (input.length > 1024) return "Input cannot be longer than 1024 characters.";
		if (!/^[,xelrudaspftynUDLR<>2-7]+$/.test(input)) return "Invalid characters in input.";
		return "";
	}

	getReplayExecString(framerate = 35, outputFile: string, input = ','): string {
		return './doomreplay/doomgeneric/doomgeneric' +
			' -iwad ./doomreplay/doom1.wad' +
			` -framerate ${framerate}` +
			' -render_frame -render_input -render_username' +
			` -output ${outputFile}` +
			` -input ${input}`
	}

	async execWithCallback(execStr = ""): Promise<string> {
		if (execStr.length === 0) throw new InternalServerErrorException("execStr cannot be empty.");
		return new Promise((resolve, reject) => {
			const process = exec(execStr);
			let output = "";

			process.stderr.on('data', (data) => {
				console.log(data);
				output += data
			});
			process.stdout.on('data', (data) => {
				console.log(data);
				output += data
			});
			process.on('exit', () => resolve(output));
			process.on('close', () => resolve(output));
			process.on('error', (err) => reject(err));
		})
	}

	getUncachedHeader(contentType: string, filename: string): any {
		return {
			'Content-Type': contentType,
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Cache-Control': 'no-cache,max-age=0',
			'Expires': 'Sun, 06 Jul 2014 07:27:43 GMT'
		}
	}

	getImageFromText(input: string): UltimateTextToImage {
		return new UltimateTextToImage(input, {
			fontSize: 12,
			fontColor: '#C1C2C5',
			backgroundColor: '#1A1B1E',
			margin: 2,
			maxWidth: 1920 / 2,
		}).render();
	}

	normalizeInput(input: string | string[]): string {
		if (input instanceof Array) input = input.join('');

		const split = input
			.replace(/(?<=[xelrudaspftynUDLR<>2-7]),/g, '') // Removes all idles, if preceded by a different key
			.match(/([,xelrudaspftynUDLR<>2-7])\1*/g) || []; // Splits into groups of consecutive keys

		const repeating: [string, number][] = split.map((i) => [i.charAt(0), i.length]); // [ [key, length], [key, length], ... ]

		let output = [];
		for (const [key, length] of repeating) {
			output.push(`${this.convertKeyToName(key)} ${length > 1 ? `[x${length}]` : ''}`);
		}

		return output.join(',');
	}

	convertKeyToName(key: string): string {
		const str: string = {
			',': 'Idle',
			'x': 'Escape',
			'e': 'Enter',
			'l': 'Left Arrow',
			'r': 'Right Arrow',
			'u': 'Up Arrow',
			'd': 'Down Arrow',
			'a': 'Alt',
			's': 'Shift',
			'p': 'Space',
			'f': 'CTRL',
			't': 'Tab',
			'U': "Shift + Up Arrow",
			'D': "Shift + Down Arrow",
			'L': "Shift + Left Arrow",
			'R': "Shift + Right Arrow",
			'<': "Strafe Left",
			'>': "Strafe Right",
			'y': 'Yes',
			'n': 'No',
			'2': 'Item Slot 2',
			'3': 'Item Slot 3',
			'4': 'Item Slot 4',
			'5': 'Item Slot 5',
			'6': 'Item Slot 6',
			'7': 'Item Slot 7',
		}[key];

		return str || "Unknown";
	}
}
