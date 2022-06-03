import { Injectable } from '@nestjs/common';
import { UltimateTextToImage } from 'ultimate-text-to-image';

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

	getImageFromText(input: string): UltimateTextToImage {
		return new UltimateTextToImage(input, {
			fontSize: 12,
			fontColor: '#C1C2C5',
			backgroundColor: '#1A1B1E',
			borderColor: '#1A1B1E',
			borderSize: 2,
			maxWidth: 1920 / 2,
		}).render();

	}
}
