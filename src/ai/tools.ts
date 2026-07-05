export const OOC_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'create_base_class',
            description: 'Create a new base class in the specified folder. Returns the result.',
            parameters: {
                type: 'object',
                properties: {
                    className: { type: 'string', description: 'The name of the new class' },
                    folderUri: { type: 'string', description: 'Absolute path of the target folder' }
                },
                required: ['className', 'folderUri']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'create_interface',
            description: 'Create a new interface with optional virtual methods.',
            parameters: {
                type: 'object',
                properties: {
                    interfaceName: { type: 'string' },
                    folderUri: { type: 'string' },
                    methods: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                returnType: { type: 'string' },
                                name: { type: 'string' },
                                params: { type: 'string' }
                            }
                        }
                    }
                },
                required: ['interfaceName', 'folderUri']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'create_subclass',
            description: 'Create a subclass that inherits from a parent class.',
            parameters: {
                type: 'object',
                properties: {
                    parentName: { type: 'string' },
                    parentHeaderPath: { type: 'string', description: 'Absolute path of parent header file' },
                    subclassName: { type: 'string' }
                },
                required: ['parentName', 'parentHeaderPath', 'subclassName']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'add_virtual_methods',
            description: 'Add virtual methods to a class. Header path can be inferred from class name (e.g., {className}.h in workspace root).',
            parameters: {
                type: 'object',
                properties: {
                    className: { type: 'string', description: 'The class name to add methods to' },
                    headerPath: { type: 'string', description: 'Absolute path to the header file (e.g., /workspace/Class.h). If not provided, use /workspace/{className}.h' },
                    methods: { type: 'array', items: { type: 'object', properties: { returnType: { type: 'string' }, name: { type: 'string' }, params: { type: 'string' } } } }
                },
                required: ['className', 'methods']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'override_method',
            description: 'Override an inherited virtual method in a subclass.',
            parameters: {
                type: 'object',
                properties: {
                    className: { type: 'string' },
                    headerPath: { type: 'string' },
                    fromClass: { type: 'string' },
                    method: {
                        type: 'object',
                        properties: {
                            returnType: { type: 'string' },
                            name: { type: 'string' },
                            params: { type: 'string' }
                        }
                    },
                    vtablePath: { type: 'string', description: 'The access path to the vtable, e.g., "parent.vtable"' }
                },
                required: ['className', 'headerPath', 'fromClass', 'method', 'vtablePath']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'add_members',
            description: 'Add member variables to a class.',
            parameters: {
                type: 'object',
                properties: {
                    className: { type: 'string' },
                    headerPath: { type: 'string' },
                    members: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                type: { type: 'string' },
                                name: { type: 'string' }
                            }
                        }
                    }
                },
                required: ['className', 'headerPath', 'members']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'add_regular_methods',
            description: 'Add regular (non-virtual) methods to a class via Fun table.',
            parameters: {
                type: 'object',
                properties: {
                    className: { type: 'string' },
                    headerPath: { type: 'string' },
                    methods: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                returnType: { type: 'string' },
                                name: { type: 'string' },
                                params: { type: 'string' }
                            }
                        }
                    }
                },
                required: ['className', 'headerPath', 'methods']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'write_source_code',
            description: 'Write generated code to the source file (.c) of a class.',
            parameters: {
                type: 'object',
                properties: {
                    headerPath: { type: 'string', description: 'Absolute path to the header file (.h)' },
                    code: { type: 'string', description: 'The C code to write' },
                    mode: { type: 'string', enum: ['replace', 'append'], description: 'Write mode, defaults to append' }
                },
                required: ['headerPath', 'code']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'modify_function_body',
            description: 'Modify the body of an existing function in the source file. Use mode "replace" to completely rewrite the function body, or "append" to add code at the end of the function.',
            parameters: {
                type: 'object',
                properties: {
                    headerPath: { type: 'string', description: 'Absolute path to the header file (.h)' },
                    functionName: { type: 'string', description: 'Name of the function to modify' },
                    codeContent: { type: 'string', description: 'The new code for replace mode, or the code snippet to append' },
                    mode: { type: 'string', enum: ['replace', 'append'], description: 'Whether to replace the entire function body or append to it' }
                },
                required: ['headerPath', 'functionName', 'codeContent', 'mode']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'add_private_function',
            description: 'Add a static (private) function to the source file.',
            parameters: {
                type: 'object',
                properties: {
                    headerPath: { type: 'string' },
                    returnType: { type: 'string' },
                    funcName: { type: 'string' },
                    params: { type: 'string', description: 'Function parameters without self pointer' },
                    body: { type: 'string', description: 'Function body code, without enclosing braces' }
                },
                required: ['headerPath', 'returnType', 'funcName', 'params', 'body']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'add_global_variable',
            description: 'Add a static global variable to the source file.',
            parameters: {
                type: 'object',
                properties: {
                    headerPath: { type: 'string' },
                    type: { type: 'string' },
                    name: { type: 'string' },
                    initialValue: { type: 'string', description: 'Optional initializer' }
                },
                required: ['headerPath', 'type', 'name']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'add_include',
            description: 'Add an include directive to the source file.',
            parameters: {
                type: 'object',
                properties: {
                    headerPath: { type: 'string' },
                    includePath: { type: 'string', description: 'Include path in quotes or angle brackets' }
                },
                required: ['headerPath', 'includePath']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'read_source_file',
            description: 'Read the current content of the source (.c) file associated with the given header file. Returns the full text.',
            parameters: {
                type: 'object',
                properties: {
                    headerPath: { type: 'string', description: 'Absolute path to the header file (.h)' }
                },
                required: ['headerPath']
            }
        }
    }
];