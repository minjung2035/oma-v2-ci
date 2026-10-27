/* Actual Darwin metadata setup, never a replacement metadata observer. */
#if !defined(__APPLE__)
#error This fixture requires public Darwin metadata APIs
#endif
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/acl.h>
#include <membership.h>
#include <unistd.h>
#include <stdio.h>
#include <string.h>

int main(int argc, char **argv) {
    if (argc != 3) return 125;
    if (!strcmp(argv[1], "flags")) {
        if (lchflags(argv[2], UF_HIDDEN) != 0) { perror("fixture lchflags"); return 1; }
        return 0;
    }
    acl_t acl = acl_init(1);
    if (acl == NULL) { perror("fixture acl_init"); return 1; }
    int status = 0;
    if (!strcmp(argv[1], "acl")) {
        acl_entry_t entry;
        acl_permset_t permissions;
        uuid_t owner;
        if (mbr_uid_to_uuid(getuid(), owner) != 0 || acl_create_entry(&acl, &entry) != 0 ||
            acl_set_tag_type(entry, ACL_EXTENDED_ALLOW) != 0 || acl_set_qualifier(entry, owner) != 0 ||
            acl_get_permset(entry, &permissions) != 0 || acl_add_perm(permissions, ACL_READ_DATA) != 0)
            status = 1;
    } else if (!strcmp(argv[1], "empty-acl-flags")) {
        acl_flagset_t flags;
        if (acl_get_flagset_np(acl, &flags) != 0 || acl_add_flag_np(flags, ACL_FLAG_NO_INHERIT) != 0)
            status = 1;
    } else status = 125;
    if (status == 0 && acl_set_link_np(argv[2], ACL_TYPE_EXTENDED, acl) != 0) {
        perror("fixture acl_set_link_np"); status = 1;
    }
    if (acl_free(acl) != 0) status = 1;
    return status;
}
