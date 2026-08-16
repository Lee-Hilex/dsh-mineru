/**
 * dsh-mineru host plugin type declarations (hand-written).
 * @module dsh-mineru
 */
import type { Context } from '@deepseek-ai/cordis';
import type z from '@deepseek-ai/schemastery';

export declare const name: 'mineru';
export declare const inject: string[];
export declare const Config: z<object>;
export declare function apply(ctx: Context, config?: Record<string, unknown>): void;
