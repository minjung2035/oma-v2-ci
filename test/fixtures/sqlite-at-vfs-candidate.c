/* Test-only public Unix-VFS syscall substitution. No SQLite internals. */
#include <sqlite3ext.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <string.h>
#include <limits.h>

#define PREFIX "/oma-held-candidate"
static const sqlite3_api_routines *host;
static sqlite3_vfs held;
static int root = -1;
static int setup_status = SQLITE_ERROR;
static int (*prior_open)(const char *,int,int);
static int (*prior_access)(const char *,int);
static int (*prior_stat)(const char *,struct stat *);
static int (*prior_lstat)(const char *,struct stat *);
static int (*prior_unlink)(const char *);
static int (*prior_directory)(const char *,int *);
static ssize_t (*prior_readlink)(const char *,char *,size_t);
static int (*prior_mkdir)(const char *,mode_t);
static int (*prior_rmdir)(const char *);

/* 0 is unrelated; 1 is our root; -1 is a refused private address. */
static int relative(const char *path,const char **name) {
  size_t length=sizeof(PREFIX)-1;
  if(!path || strncmp(path,PREFIX,length))return 0;
  if(path[length] && path[length]!='/')return 0;
  *name=path+length+(path[length]=='/');
  if(root<0){errno=EBADF;return -1;}
  if(strchr(*name,'/') || !strcmp(*name,".") || !strcmp(*name,"..")){
    errno=EINVAL;return -1;
  }
  return 1;
}
static int at_open(const char *path,int flags,int mode) {
  const char *name;int found=relative(path,&name);
  if(found<0)return -1;
  if(!found)return prior_open(path,flags,mode);
  return openat(root,*name?name:".",flags|O_CLOEXEC|O_NOFOLLOW,mode);
}
static int at_access(const char *path,int mode) {
  const char *name;int found=relative(path,&name);
  if(found<0)return -1;
  return found?faccessat(root,*name?name:".",mode,0):prior_access(path,mode);
}
static int at_stat(const char *path,struct stat *out) {
  const char *name;int found=relative(path,&name),status;
  if(found<0)return -1;
  if(!found)return prior_stat(path,out);
  status=*name?fstatat(root,name,out,AT_SYMLINK_NOFOLLOW):fstat(root,out);
  if(!status && S_ISLNK(out->st_mode)){errno=ELOOP;return -1;}
  return status;
}
static int at_lstat(const char *path,struct stat *out) {
  const char *name;int found=relative(path,&name);
  if(found<0)return -1;
  if(!found)return prior_lstat(path,out);
  return *name?fstatat(root,name,out,AT_SYMLINK_NOFOLLOW):fstat(root,out);
}
static int at_unlink(const char *path) {
  const char *name;int found=relative(path,&name);
  if(found<0)return -1;
  if(!found)return prior_unlink(path);
  if(!*name){errno=EINVAL;return -1;}
  return unlinkat(root,name,0);
}
static int at_directory(const char *path,int *out) {
  const char *name;int found=relative(path,&name);
  if(found<0)return SQLITE_CANTOPEN;
  if(!found)return prior_directory(path,out);
  *out=fcntl(root,F_DUPFD_CLOEXEC,0);
  return *out<0?SQLITE_CANTOPEN:SQLITE_OK;
}
static ssize_t at_readlink(const char *path,char *out,size_t capacity) {
  const char *name;int found=relative(path,&name);
  if(found<0)return -1;
  return found?readlinkat(root,*name?name:".",out,capacity):prior_readlink(path,out,capacity);
}
static int at_mkdir(const char *path,mode_t mode) {
  const char *name;int found=relative(path,&name);
  if(found<0)return -1;
  return found?mkdirat(root,name,mode):prior_mkdir(path,mode);
}
static int at_rmdir(const char *path) {
  const char *name;int found=relative(path,&name);
  if(found<0)return -1;
  if(!found)return prior_rmdir(path);
  errno=EPERM;return -1;
}
static int fullname(sqlite3_vfs *vfs,const char *path,int capacity,char *out) {
  const char *name;(void)vfs;
  if(relative(path,&name)!=1 || !*name || strlen(path)>=(size_t)capacity)return SQLITE_CANTOPEN;
  memcpy(out,path,strlen(path)+1);return SQLITE_OK;
}
static void bind_root(sqlite3_context *context,int count,sqlite3_value **values) {
  int descriptor;struct stat status;(void)count;
  if(setup_status!=SQLITE_OK){host->result_error(context,"candidate syscall setup refused",-1);return;}
  if(root>=0){host->result_error(context,"candidate already bound",-1);return;}
  sqlite3_int64 value=host->value_int64(values[0]);
  if(value<0 || value>INT_MAX){host->result_error(context,"invalid descriptor",-1);return;}
  descriptor=fcntl((int)value,F_DUPFD_CLOEXEC,0);
  if(descriptor<0){host->result_error(context,"cannot duplicate directory",-1);return;}
  if(fstat(descriptor,&status) || !S_ISDIR(status.st_mode)){
    close(descriptor);host->result_error(context,"not a directory",-1);return;
  }
  root=descriptor;host->result_text(context,PREFIX,-1,SQLITE_STATIC);
}
static void unbind_root(sqlite3_context *context,int count,sqlite3_value **values) {
  int descriptor=root;(void)count;(void)values;root=-1;
  if(descriptor>=0 && close(descriptor))host->result_error(context,"directory return failed",-1);
  else host->result_null(context);
}

#define HOOK(NAME,TYPE) do { \
  prior_##NAME=(TYPE)original->xGetSystemCall(original,#NAME); \
  if(!prior_##NAME || original->xSetSystemCall(original,#NAME,(sqlite3_syscall_ptr)at_##NAME)!=SQLITE_OK)return SQLITE_OK_LOAD_PERMANENTLY; \
} while(0)
__attribute__((visibility("default")))
int sqlite3_extension_init(sqlite3 *db,char **error,const sqlite3_api_routines *api) {
  (void)error;host=api;
  int result=api->create_function(db,"oma_candidate_bind",1,SQLITE_UTF8,NULL,bind_root,NULL,NULL);
  if(result!=SQLITE_OK)return result;
  result=api->create_function(db,"oma_candidate_unbind",0,SQLITE_UTF8,NULL,unbind_root,NULL,NULL);
  if(result!=SQLITE_OK)return result;
  /* Once a callback is installed this image must stay loaded even when a
   * later setup operation refuses. bind_root reports that refusal. */
#ifdef __APPLE__
  sqlite3_vfs *original=api->vfs_find("unix-posix");
#else
  sqlite3_vfs *original=api->vfs_find("unix");
#endif
  if(!original || original->iVersion<3 || !original->xGetSystemCall || !original->xSetSystemCall)return SQLITE_ERROR;
  HOOK(open,int(*)(const char *,int,int));
  HOOK(access,int(*)(const char *,int));
  HOOK(stat,int(*)(const char *,struct stat *));
  HOOK(unlink,int(*)(const char *));
  /* The public hook is named openDirectory, not directory. */
  prior_directory=(int(*)(const char *,int *))original->xGetSystemCall(original,"openDirectory");
  if(!prior_directory || original->xSetSystemCall(original,"openDirectory",(sqlite3_syscall_ptr)at_directory)!=SQLITE_OK)return SQLITE_OK_LOAD_PERMANENTLY;
  HOOK(mkdir,int(*)(const char *,mode_t));
  HOOK(rmdir,int(*)(const char *));
  prior_lstat=(int(*)(const char *,struct stat *))original->xGetSystemCall(original,"lstat");
  if(prior_lstat && original->xSetSystemCall(original,"lstat",(sqlite3_syscall_ptr)at_lstat)!=SQLITE_OK)return SQLITE_OK_LOAD_PERMANENTLY;
  prior_readlink=(ssize_t(*)(const char *,char *,size_t))original->xGetSystemCall(original,"readlink");
  if(prior_readlink && original->xSetSystemCall(original,"readlink",(sqlite3_syscall_ptr)at_readlink)!=SQLITE_OK)return SQLITE_OK_LOAD_PERMANENTLY;
  held=*original;held.zName="oma-at-candidate";held.pNext=NULL;held.xFullPathname=fullname;
  setup_status=api->vfs_register(&held,0);
  return SQLITE_OK_LOAD_PERMANENTLY;
}
