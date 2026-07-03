export function generateSubclassSource(childName: string, parentName: string): string {
    return `#include "${childName}.h"
#include <stdlib.h>
#include <string.h>

const struct ${childName}Fun ${childName}_fun = {
    .destroy = ${childName}_destroy,
};

${childName} *${childName}_create(void) {
    ${childName} *self = (${childName}*)malloc(sizeof(${childName}));
    if (!self) return NULL;
    memset(self, 0, sizeof(${childName}));
    ${childName}_init(self);
    return self;
}

void ${childName}_destroy(${childName} *self) {
    if (!self) return;
    ${childName}_deinit(self);
    free(self);
}

void ${childName}_init(${childName} *self) {
    if (!self) return;
    ${parentName}_init(&self->parent);
    self->fun = &${childName}_fun;
}

void ${childName}_deinit(${childName} *self) {
    if (!self) return;
    ${parentName}_deinit(&self->parent);
}
`;
}