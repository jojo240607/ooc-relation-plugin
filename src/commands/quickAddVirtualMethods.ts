import * as vscode from 'vscode';
import { addVirtualMethods } from '../operations/addVirtualMethodOperation';

export async function quickAddVirtualMethods(
    className: string,
    headerUri: vscode.Uri,
    methods: { returnType: string; name: string; params: string }[]
): Promise<{ success: boolean; message: string }> {
    return await addVirtualMethods(className, headerUri, methods);
}