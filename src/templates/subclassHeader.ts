export function generateSubclassHeader(childName: string, parentName: string): string {
    const guard = `${childName.toUpperCase()}_H`;
    return `#ifndef ${guard}
#define ${guard}

#include "${parentName}.h"

typedef struct _${childName} ${childName};

struct ${childName}Fun {
    void (*destroy)(${childName} *self);
};

struct _${childName} {
    ${parentName} parent;
    const struct ${childName}Fun *fun;
};

${childName} *${childName}_create(void);
void ${childName}_destroy(${childName} *self);
void ${childName}_init(${childName} *self);
void ${childName}_deinit(${childName} *self);

extern const struct ${childName}Fun ${childName}_fun;

#endif /* ${guard} */
`;
}