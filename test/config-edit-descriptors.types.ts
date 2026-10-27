import {
  EDITABLE_FIELD_DESCRIPTORS,
  type EditableField,
  type EditableFieldDescriptor,
} from "#oma-test/app/application/settings";

const descriptor = null as unknown as EditableFieldDescriptor;
const complete = {
  "principal-model": descriptor,
  "worker-model": descriptor,
  "initial-workers": descriptor,
  "worker-profile": descriptor,
  "worker-integrate": descriptor,
} satisfies Readonly<Record<EditableField, EditableFieldDescriptor>>;

const productionRegistry: Readonly<Record<EditableField, EditableFieldDescriptor>> =
  EDITABLE_FIELD_DESCRIPTORS;
void complete;
void productionRegistry;

// A compile-only negative fixture: widening EditableField to string or weakening
// the registry to Record<string, ...> makes this expected error disappear.
// @ts-expect-error worker-profile is a required editable descriptor
const missing: Readonly<Record<EditableField, EditableFieldDescriptor>> = {
  "principal-model": descriptor,
  "worker-model": descriptor,
  "initial-workers": descriptor,
};
void missing;
