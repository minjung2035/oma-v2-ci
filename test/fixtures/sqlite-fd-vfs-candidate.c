/* Public SQLite loadable-extension/VFS probe only; no business SQL or role. */
#include <sqlite3ext.h>
#include <string.h>
#include <stdio.h>
static sqlite3_vfs held;
static int fullname(sqlite3_vfs *vfs, const char *name, int capacity, char *out) {
  (void)vfs;
  if (!name || (strncmp(name,"/proc/self/fd/",14) && strncmp(name,"/dev/fd/",8))) return SQLITE_CANTOPEN;
  size_t length=strlen(name);
  if(length>=(size_t)capacity)return SQLITE_CANTOPEN;
  memcpy(out,name,length+1);return SQLITE_OK;
}
#ifdef __GNUC__
__attribute__((visibility("default")))
#endif
int sqlite3_extension_init(sqlite3 *db,char **error,const sqlite3_api_routines *api) {
  (void)db;(void)error;
  sqlite3_vfs *original=api->vfs_find(NULL);
  if(!original)return SQLITE_ERROR;
  if(api->vfs_find("oma-held-path-candidate"))return SQLITE_OK_LOAD_PERMANENTLY;
  held=*original;held.zName="oma-held-path-candidate";held.pNext=NULL;held.xFullPathname=fullname;
  int status=api->vfs_register(&held,0);
  return status==SQLITE_OK?SQLITE_OK_LOAD_PERMANENTLY:status;
}
