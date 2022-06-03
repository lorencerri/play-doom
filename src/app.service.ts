import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
	getHello(): string {
		return 'Hello World!';
	}

	isValidInput(input = ""): boolean {
		if (input.length === 0) return false;
		if (!/^[,xelrudaspftynUDLR<>2-7]+$/.test(input)) return false;
		return true;
	}
}
