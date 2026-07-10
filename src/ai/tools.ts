export const OOC_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'create_base_class',
            description: `必须使用本工具创建全新的基类。
                          使用场景：当用户要求“新建一个类”、“定义一个XXX类”且该类不继承任何其他类时。
                          不要通过 write_source_code 在已有文件中书写新的结构体来模拟创建类，这会破坏代码组织。`,
            parameters: {
                type: 'object',
                properties: {
                    className: { type: 'string', description: '类名，PascalCase 格式' },
                    folderUri: { type: 'string', description: '可选，指定类文件存放的目录 URI，默认为项目根目录' }
                },
                required: ['className', 'folderUri']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'create_interface',
            description: `必须使用本工具创建纯虚接口（抽象类）。
                            使用场景：当用户要求定义接口、抽象基类、纯虚类、协议时。
                            本工具会生成只包含虚函数表的结构体，不包含具体实现。
                            禁止使用 write_source_code 在已有文件中手动添加接口结构体。`,
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
                        },
                        description: '纯虚函数列表,带返回值和参数'
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
            description: `必须使用本工具创建继承自某个父类的子类。
                            使用场景：当用户要求“继承XXX”、“基于XXX创建子类”、“派生类”时。
                            本工具会正确设置结构体嵌套和虚表继承。
                            不要通过 write_source_code 在子类的 .c 文件中重新定义一个父类结构体，那会导致类型不一致。`,
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
            name: 'set_code_section',
            description: `精确替换文件中的命名代码区块（函数定义、结构体定义等）。自动同步头文件声明。
                        - 对于函数：newCode 需包含完整的返回类型、函数名、参数和函数体。工具会自动从中提取签名并更新 .h 声明。
                        - 对于结构体：newCode 需包含完整的 typedef struct { ... } Name; 工具会直接替换头文件中的定义。
                        - 使用前必须先通过 get_code_snippet 获取当前定义，确保修改基于最新代码。`,
            parameters: {
                type: 'object',
                properties: {
                    headerPath: { type: 'string', description: '头文件的绝对路径' },
                    sectionName: { type: 'string', description: '函数全名(如 ClassName_method) 或结构体名(如 RingBufferStats)' },
                    newCode: { type: 'string', description: '完整的最终代码区块' },
                    sectionType: { type: 'string', enum: ['function', 'struct', 'auto'], description: '代码区块类型，auto 会自动检测' }
                },
                required: ['headerPath', 'sectionName', 'newCode']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'write_source_code',
            description: `批量写入或完全替换 .c 文件的内容。
                            此工具仅用于其他专用工具无法覆盖的场景，例如：
                            - 完全重写整个实现文件。
                            - 写入纯数据定义（如全局枚举、普通辅助结构体、常量数组等）。
                            - 批量注入包含多个函数的大段代码。

                            注意：
                            - 新增单个私有函数请使用 add_private_function。
                            - 修改已有函数体请使用 modify_function_body。
                            - 新增公开方法请使用 add_regular_method。
                            - 添加成员变量请使用 add_global_variable。`,
            parameters: {
                type: 'object',
                properties: {
                    headerPath: {
                        type: 'string',
                        description: '对应的头文件路径（绝对路径）。如果提供了 outputPath，此参数仅用于定位项目上下文，可省略。'
                    },
                    outputPath: {
                        type: 'string',
                        description: '可选：直接指定要写入的 .c 文件绝对路径。若提供，则覆盖基于 headerPath 的默认路径。用于创建测试文件等非类文件。'
                    },
                    code: {
                        type: 'string',
                        description: '要写入的 C 代码'
                    },
                    mode: {
                        type: 'string',
                        enum: ['replace', 'append'],
                        description: '写入模式，默认为 append'
                    }
                },
                required: ['code']  // 注意：headerPath 不再是必需，由 outputPath 替代
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
            description: `当需要在 .c 文件中添加一个带有 static 关键字的私有函数时，必须使用本工具
                          本工具会自动处理 static 关键字的添加，并确保不会重复。
                          不要用 write_source_code来手动添加私有函数，否则容易导致 static 重复或签名错误。`,
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
            description: 'Add an include directive to the source and head file.',
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
    },
    {
        type: "function",
        function: {
            name: "update_ai_prompt",
            description: "更新项目的 AI 提示词配置文件 (.vscode/ooc-ai-prompt.txt)，用于沉淀经验、修复规则或添加约定。",
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["append", "replace_section", "prepend"],
                        description: "操作类型：append(末尾追加)、replace_section(替换指定章节)、prepend(开头插入)"
                    },
                    section_title: {
                        type: "string",
                        description: "当 action=replace_section 时，指定要替换的章节标题（不含 ##）"
                    },
                    content: {
                        type: "string",
                        description: "要写入的新内容（纯文本，可以包含 Markdown 标记但非强制）"
                    }
                },
                required: ["action", "content"]
            }
        }
    }
];