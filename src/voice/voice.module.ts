import { Module } from '@nestjs/common';
import { MenuModule } from '../menu/menu.module';
import { VoiceController } from './voice.controller';

@Module({ imports: [MenuModule], controllers: [VoiceController] })
export class VoiceModule {}
