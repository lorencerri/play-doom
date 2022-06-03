import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { UltimateTextToImage } from 'ultimate-text-to-image';
import { exec } from 'child_process';
import { QuickDB } from 'quick.db';

const db = new QuickDB();

@Injectable()
export class AppService {
	getHello(): string {
		return 'Hello World!';
	}

	async getInput(namespace: string): Promise<string[]> {
		const input: string[] = await db.get(`input_${namespace}`) || [];
		return ['x,', ...input];
	}

	validateNamespace(namespace: string): void {
		if (namespace.length === 0) throw new BadRequestException("query.namespace cannot be empty.")
		if (namespace.length > 32) throw new BadRequestException("query.namespace cannot be longer than 32 characters.")
		if (!/^[a-zA-Z0-9_]+$/.test(namespace)) throw new BadRequestException("Invalid characters in query.namespace.")
	}

	validateInput(input: string): void {
		if (input.length === 0) throw new BadRequestException("query.keys cannot be empty.");
		if (input.length > 1024) throw new BadRequestException("query.keys cannot be longer than 1024 characters.");
		if (!/^[,xelrudaspftynUDLR<>2-7]+$/.test(input)) throw new BadRequestException("Invalid characters in query.keys.");
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

			process.stderr.on('data', console.log);
			process.stdout.on('data', console.log);
			process.on('exit', () => resolve(""));
			process.on('close', () => resolve(""));
			process.on('error', (err) => resolve(err.message));
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
			output.push(`${this.convertKeyToName(key)}${length > 1 ? ` [x${length}]` : ''}`);
		}

		return output.join(', ');
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
