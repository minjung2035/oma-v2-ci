/* A held-directory adapter for the host's public SQLite Unix POSIX VFS.
 * The host engine owns SQL, recovery, locking and WAL. No private structs. */
#include <sqlite3ext.h>
#include <sys/stat.h>
#include <pthread.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define PREFIX "/.oma-sqlite/"
typedef struct Root Root;
struct Root {
  sqlite3_vfs vfs;
  int fd;
  unsigned files;
  unsigned references;
  dev_t device;
  ino_t inode;
  int return_failed, retiring;
  char id[33], name[48], prefix[sizeof(PREFIX)+33];
  Root *next;
};
typedef struct {
  sqlite3_file base;
  sqlite3_file *inner;
  Root *root;
  sqlite3_filename temporary;
} File;
static const sqlite3_api_routines *api;
static sqlite3_vfs *original;
static Root *roots;
static pthread_mutex_t mutex=PTHREAD_MUTEX_INITIALIZER;
static pthread_mutex_t initialization=PTHREAD_MUTEX_INITIALIZER;
static pthread_mutex_t bindings=PTHREAD_MUTEX_INITIALIZER;
static int setup_status=SQLITE_ERROR;

static int (*prior_open)(const char *,int,int);
static int (*prior_access)(const char *,int);
static int (*prior_stat)(const char *,struct stat *);
static int (*prior_lstat)(const char *,struct stat *);
static int (*prior_unlink)(const char *);
static int (*prior_directory)(const char *,int *);
static ssize_t (*prior_readlink)(const char *,char *,size_t);
static int (*prior_mkdir)(const char *,mode_t);
static int (*prior_rmdir)(const char *);

static void random_id(char out[33]) {
  unsigned char bytes[16];
  static const char hex[]="0123456789abcdef";
  arc4random_buf(bytes,sizeof bytes);
  for(int i=0;i<16;i++){out[2*i]=hex[bytes[i]>>4];out[2*i+1]=hex[bytes[i]&15];}
  out[32]=0;
}
/* Called under mutex. Every private-prefix failure refuses; no path fallback. */
static int locate(const char *path,Root **root,const char **name) {
  size_t prefix=sizeof(PREFIX)-1;
  if(!path || strncmp(path,PREFIX,prefix))return 0;
  const char *id=path+prefix;
  if(strlen(id)<32 || (id[32] && id[32]!='/')){errno=EINVAL;return -1;}
  *name=id+32+(id[32]=='/');
  if(strchr(*name,'/') || !strcmp(*name,".") || !strcmp(*name,"..")){
    errno=EINVAL;return -1;
  }
  for(Root *r=roots;r;r=r->next)if(!r->retiring && !r->return_failed && !strncmp(r->id,id,32)){*root=r;return 1;}
  errno=EBADF;return -1;
}
static int at_open(const char *path,int flags,int mode) {
  Root *root;const char *name;pthread_mutex_lock(&mutex);
  int found=locate(path,&root,&name),fd=-1;
  if(found==1){
    int safe=flags|O_CLOEXEC|O_NOFOLLOW;
#ifdef __APPLE__
    safe=(safe&~O_NOFOLLOW)|O_NOFOLLOW_ANY|O_RESOLVE_BENEATH;
#endif
    fd=openat(root->fd,*name?name:".",safe,mode);
    if(fd>=0){
      struct stat status;
      int observed=fstat(fd,&status);
      if(observed || (*name && (!S_ISREG(status.st_mode) || status.st_nlink!=1 || status.st_uid!=geteuid()))){
        int error=observed?errno:EPERM;close(fd);fd=-1;errno=error;
      }
    }
  }
  int error=errno;pthread_mutex_unlock(&mutex);errno=error;
  return found==0?prior_open(path,flags,mode):fd;
}
static int at_access(const char *path,int mode) {
  Root *root;const char *name;pthread_mutex_lock(&mutex);
  int found=locate(path,&root,&name),result=-1;
  if(found==1)result=faccessat(root->fd,*name?name:".",mode,0);
  int error=errno;pthread_mutex_unlock(&mutex);errno=error;
  return found==0?prior_access(path,mode):result;
}
static int at_stat(const char *path,struct stat *out) {
  Root *root;const char *name;pthread_mutex_lock(&mutex);
  int found=locate(path,&root,&name),result=-1;
  if(found==1){
    result=*name?fstatat(root->fd,name,out,AT_SYMLINK_NOFOLLOW):fstat(root->fd,out);
    if(!result && S_ISLNK(out->st_mode)){errno=ELOOP;result=-1;}
  }
  int error=errno;pthread_mutex_unlock(&mutex);errno=error;
  return found==0?prior_stat(path,out):result;
}
static int at_lstat(const char *path,struct stat *out) {
  Root *root;const char *name;pthread_mutex_lock(&mutex);
  int found=locate(path,&root,&name),result=-1;
  if(found==1)result=*name?fstatat(root->fd,name,out,AT_SYMLINK_NOFOLLOW):fstat(root->fd,out);
  int error=errno;pthread_mutex_unlock(&mutex);errno=error;
  return found==0?prior_lstat(path,out):result;
}
static int at_unlink(const char *path) {
  Root *root;const char *name;pthread_mutex_lock(&mutex);
  int found=locate(path,&root,&name),result=-1;
  if(found==1){if(*name)result=unlinkat(root->fd,name,0);else errno=EPERM;}
  int error=errno;pthread_mutex_unlock(&mutex);errno=error;
  return found==0?prior_unlink(path):result;
}
static int at_directory(const char *path,int *out) {
  Root *root;const char *name;pthread_mutex_lock(&mutex);
  int found=locate(path,&root,&name),result=SQLITE_CANTOPEN;
  if(found==1){*out=fcntl(root->fd,F_DUPFD_CLOEXEC,0);if(*out>=0)result=SQLITE_OK;}
  pthread_mutex_unlock(&mutex);
  return found==0?prior_directory(path,out):result;
}
static ssize_t at_readlink(const char *path,char *out,size_t capacity) {
  Root *root;const char *name;pthread_mutex_lock(&mutex);
  int found=locate(path,&root,&name);ssize_t result=-1;
  if(found==1)result=readlinkat(root->fd,*name?name:".",out,capacity);
  int error=errno;pthread_mutex_unlock(&mutex);errno=error;
  return found==0?prior_readlink(path,out,capacity):result;
}
static int at_mkdir(const char *path,mode_t mode) {
  Root *root;const char *name;pthread_mutex_lock(&mutex);
  int found=locate(path,&root,&name),result=-1;
  if(found==1)result=mkdirat(root->fd,name,mode);
  int error=errno;pthread_mutex_unlock(&mutex);errno=error;
  return found==0?prior_mkdir(path,mode):result;
}
static int at_rmdir(const char *path) {
  Root *root;const char *name;pthread_mutex_lock(&mutex);
  int found=locate(path,&root,&name);pthread_mutex_unlock(&mutex);
  if(found==0)return prior_rmdir(path);
  errno=EPERM;return -1;
}

static int close_file(sqlite3_file *file) {
  File *f=(File *)file;
  int status=f->inner->pMethods->xClose(f->inner);
  api->free(f->inner);api->free_filename(f->temporary);f->base.pMethods=NULL;
  pthread_mutex_lock(&mutex);f->root->files--;if(status!=SQLITE_OK)f->root->return_failed=1;pthread_mutex_unlock(&mutex);
  return status;
}
#define INNER(f) (((File *)(f))->inner)
static int read_file(sqlite3_file *f,void *b,int n,sqlite3_int64 p){return INNER(f)->pMethods->xRead(INNER(f),b,n,p);}
static int write_file(sqlite3_file *f,const void *b,int n,sqlite3_int64 p){return INNER(f)->pMethods->xWrite(INNER(f),b,n,p);}
static int truncate_file(sqlite3_file *f,sqlite3_int64 n){return INNER(f)->pMethods->xTruncate(INNER(f),n);}
static int sync_file(sqlite3_file *f,int flags){return INNER(f)->pMethods->xSync(INNER(f),flags);}
static int size_file(sqlite3_file *f,sqlite3_int64 *n){return INNER(f)->pMethods->xFileSize(INNER(f),n);}
static int lock_file(sqlite3_file *f,int kind){return INNER(f)->pMethods->xLock(INNER(f),kind);}
static int unlock_file(sqlite3_file *f,int kind){return INNER(f)->pMethods->xUnlock(INNER(f),kind);}
static int reserved_file(sqlite3_file *f,int *out){return INNER(f)->pMethods->xCheckReservedLock(INNER(f),out);}
static int control_file(sqlite3_file *file,int op,void *out){
  File *f=(File *)file;
  if(op==SQLITE_FCNTL_VFS_POINTER){*(sqlite3_vfs **)out=&f->root->vfs;return SQLITE_OK;}
  if(op==SQLITE_FCNTL_FILE_POINTER){*(sqlite3_file **)out=file;return SQLITE_OK;}
  if(op==SQLITE_FCNTL_TEMPFILENAME){
    char id[33];random_id(id);*(char **)out=api->mprintf("%s.oma-temp-%s",f->root->prefix,id);
    return *(char **)out?SQLITE_OK:SQLITE_NOMEM;
  }
  return f->inner->pMethods->xFileControl(f->inner,op,out);
}
static int sector_file(sqlite3_file *f){return INNER(f)->pMethods->xSectorSize(INNER(f));}
static int device_file(sqlite3_file *f){return INNER(f)->pMethods->xDeviceCharacteristics(INNER(f));}
static int shm_map(sqlite3_file *f,int page,int size,int extend,void volatile **out){return INNER(f)->pMethods->xShmMap?INNER(f)->pMethods->xShmMap(INNER(f),page,size,extend,out):SQLITE_IOERR_SHMMAP;}
static int shm_lock(sqlite3_file *f,int offset,int n,int flags){return INNER(f)->pMethods->xShmLock(INNER(f),offset,n,flags);}
static void shm_barrier(sqlite3_file *f){INNER(f)->pMethods->xShmBarrier(INNER(f));}
static int shm_unmap(sqlite3_file *f,int remove){return INNER(f)->pMethods->xShmUnmap(INNER(f),remove);}
static int fetch_file(sqlite3_file *f,sqlite3_int64 offset,int n,void **out){return INNER(f)->pMethods->xFetch(INNER(f),offset,n,out);}
static int unfetch_file(sqlite3_file *f,sqlite3_int64 offset,void *p){return INNER(f)->pMethods->xUnfetch(INNER(f),offset,p);}
static const sqlite3_io_methods methods={3,close_file,read_file,write_file,truncate_file,sync_file,size_file,lock_file,unlock_file,reserved_file,control_file,sector_file,device_file,shm_map,shm_lock,shm_barrier,shm_unmap,fetch_file,unfetch_file};

static Root *root_of(sqlite3_vfs *vfs){for(Root *r=roots;r;r=r->next)if(&r->vfs==vfs)return r;return NULL;}
static int open_file(sqlite3_vfs *vfs,sqlite3_filename name,sqlite3_file *file,int flags,int *out) {
  File *f=(File *)file;memset(f,0,sizeof *f);
  pthread_mutex_lock(&mutex);Root *root=root_of(vfs);
  if(root && !root->retiring && !root->return_failed)root->files++;else root=NULL;pthread_mutex_unlock(&mutex);
  if(!root)return SQLITE_CANTOPEN;
  f->root=root;
  if(!name){
    char id[33],path[256];random_id(id);snprintf(path,sizeof path,"%s.oma-temp-%s",root->prefix,id);
    f->temporary=api->create_filename(path,"","",0,NULL);name=f->temporary;
  }
  f->inner=api->malloc64((sqlite3_uint64)original->szOsFile);
  if(!name || !f->inner){
    api->free(f->inner);api->free_filename(f->temporary);
    pthread_mutex_lock(&mutex);root->files--;pthread_mutex_unlock(&mutex);return SQLITE_NOMEM;
  }
  memset(f->inner,0,(size_t)original->szOsFile);
  int status=original->xOpen(original,name,f->inner,flags,out);
  if(f->inner->pMethods){
    if(f->inner->pMethods->iVersion!=3){
      int closed=f->inner->pMethods->xClose(f->inner);status=SQLITE_CANTOPEN;
      if(closed!=SQLITE_OK){pthread_mutex_lock(&mutex);root->return_failed=1;pthread_mutex_unlock(&mutex);}
    }else{f->base.pMethods=&methods;return status;}
  }
  api->free(f->inner);api->free_filename(f->temporary);
  pthread_mutex_lock(&mutex);root->files--;pthread_mutex_unlock(&mutex);return status;
}
static int fullname(sqlite3_vfs *vfs,const char *path,int capacity,char *out) {
  Root *root;const char *name;pthread_mutex_lock(&mutex);
  int found=locate(path,&root,&name),valid=found==1 && &root->vfs==vfs && *name && strlen(path)<(size_t)capacity;
  if(valid)memcpy(out,path,strlen(path)+1);
  pthread_mutex_unlock(&mutex);
  return valid?SQLITE_OK:SQLITE_CANTOPEN;
}

static void do_bind_root(sqlite3_context *context,int count,sqlite3_value **values) {
  (void)count;sqlite3_int64 value=api->value_int64(values[0]);struct stat status;
  if(setup_status!=SQLITE_OK || value<0 || value>INT_MAX){api->result_error(context,"SQLite root adapter unavailable",-1);return;}
  int fd=fcntl((int)value,F_DUPFD_CLOEXEC,0);
  if(fd<0){api->result_error(context,"SQLite root cannot be duplicated",-1);return;}
  if(fstat(fd,&status) || !S_ISDIR(status.st_mode) || status.st_uid!=geteuid() || (status.st_mode&0022)){
    close(fd);api->result_error(context,"SQLite root must be a privately owned directory",-1);return;
  }
  /* SQLite shares its Unix WAL index by inode, across connections. All
   * bindings of one held directory must therefore retain the same namespace
   * until the last binding and the last public file owner have returned. */
  pthread_mutex_lock(&mutex);
  for(Root *r=roots;r;r=r->next)if(r->device==status.st_dev && r->inode==status.st_ino){
    if(r->retiring || r->return_failed){pthread_mutex_unlock(&mutex);close(fd);api->result_error(context,"SQLite directory has an unreturned owner",-1);return;}
    r->references++;pthread_mutex_unlock(&mutex);
    if(close(fd)){
      pthread_mutex_lock(&mutex);r->references--;pthread_mutex_unlock(&mutex);
      api->result_error(context,"SQLite duplicate root return failed",-1);api->result_error_code(context,SQLITE_IOERR_CLOSE);return;
    }
    api->result_text(context,r->prefix,-1,SQLITE_TRANSIENT);return;
  }
  pthread_mutex_unlock(&mutex);
  Root *root=api->malloc64(sizeof *root);
  if(!root){close(fd);api->result_error_nomem(context);return;}
  memset(root,0,sizeof *root);root->fd=fd;root->references=1;root->device=status.st_dev;root->inode=status.st_ino;random_id(root->id);
  snprintf(root->name,sizeof root->name,"oma-root-%s",root->id);snprintf(root->prefix,sizeof root->prefix,PREFIX "%s/",root->id);
  root->vfs=*original;root->vfs.zName=root->name;root->vfs.pNext=NULL;root->vfs.szOsFile=sizeof(File);root->vfs.xOpen=open_file;root->vfs.xFullPathname=fullname;
  pthread_mutex_lock(&mutex);
  for(Root *r=roots;r;r=r->next)if(!strcmp(r->id,root->id)){
    pthread_mutex_unlock(&mutex);close(fd);api->free(root);api->result_error(context,"SQLite root identity collision",-1);return;
  }
  root->next=roots;roots=root;pthread_mutex_unlock(&mutex);
  int result=api->vfs_register(&root->vfs,0);
  if(result!=SQLITE_OK){
    pthread_mutex_lock(&mutex);Root **link=&roots;while(*link!=root)link=&(*link)->next;*link=root->next;pthread_mutex_unlock(&mutex);
    close(fd);api->free(root);api->result_error(context,"SQLite root VFS registration refused",-1);return;
  }
  api->result_text(context,root->prefix,-1,SQLITE_TRANSIENT);
}
static void do_unbind_root(sqlite3_context *context,int count,sqlite3_value **values) {
  (void)count;const char *prefix=(const char *)api->value_text(values[0]);
  pthread_mutex_lock(&mutex);Root *root=roots;
  while(root && (!prefix || strcmp(prefix,root->prefix)))root=root->next;
  if(root && !root->retiring && !root->return_failed && root->references>1){
    root->references--;pthread_mutex_unlock(&mutex);api->result_null(context);return;
  }
  if(!root || root->files || root->return_failed || root->retiring){
    int reason=root && root->return_failed?SQLITE_IOERR_CLOSE:root && root->files?SQLITE_BUSY:SQLITE_NOTFOUND;
    pthread_mutex_unlock(&mutex);api->result_error(context,"SQLite root still has open files or is unknown",-1);api->result_error_code(context,reason);return;
  }
  /* A live VFS entry is retained until every public file owner has closed. */
  root->retiring=1;pthread_mutex_unlock(&mutex);
  if(api->vfs_unregister(&root->vfs)!=SQLITE_OK){pthread_mutex_lock(&mutex);root->retiring=0;pthread_mutex_unlock(&mutex);api->result_error(context,"SQLite root VFS return refused",-1);return;}
  pthread_mutex_lock(&mutex);Root **link=&roots;while(*link!=root)link=&(*link)->next;*link=root->next;pthread_mutex_unlock(&mutex);
  int fd=root->fd;api->free(root);
  if(close(fd)){api->result_error(context,"SQLite root descriptor return failed",-1);api->result_error_code(context,SQLITE_IOERR_CLOSE);}else api->result_null(context);
}
static void bind_root(sqlite3_context *context,int count,sqlite3_value **values){
  pthread_mutex_lock(&bindings);do_bind_root(context,count,values);pthread_mutex_unlock(&bindings);
}
static void unbind_root(sqlite3_context *context,int count,sqlite3_value **values){
  pthread_mutex_lock(&bindings);do_unbind_root(context,count,values);pthread_mutex_unlock(&bindings);
}

#define HOOK(NAME,TYPE) do { \
  prior_##NAME=(TYPE)original->xGetSystemCall(original,#NAME); \
  if(!prior_##NAME || original->xSetSystemCall(original,#NAME,(sqlite3_syscall_ptr)at_##NAME)!=SQLITE_OK)return SQLITE_OK_LOAD_PERMANENTLY; \
} while(0)
static int initialize(sqlite3 *db,const sqlite3_api_routines *host) {
  if(api && api!=host)return SQLITE_ERROR;
  if(!api)api=host;
  int result=api->create_function(db,"oma_root_bind",1,SQLITE_UTF8|SQLITE_DIRECTONLY,NULL,bind_root,NULL,NULL);
  if(result!=SQLITE_OK)return result;
  result=api->create_function(db,"oma_root_unbind",1,SQLITE_UTF8|SQLITE_DIRECTONLY,NULL,unbind_root,NULL,NULL);
  if(result!=SQLITE_OK)return result;
  if(original)return SQLITE_OK_LOAD_PERMANENTLY;
#ifdef __APPLE__
  original=api->vfs_find("unix-posix");
#else
  original=api->vfs_find("unix");
#endif
  if(!original || original->iVersion<3 || !original->xGetSystemCall || !original->xSetSystemCall || !api->create_filename || !api->free_filename)return SQLITE_ERROR;
  HOOK(open,int(*)(const char *,int,int));HOOK(access,int(*)(const char *,int));HOOK(stat,int(*)(const char *,struct stat *));HOOK(unlink,int(*)(const char *));
  prior_directory=(int(*)(const char *,int *))original->xGetSystemCall(original,"openDirectory");
  if(!prior_directory || original->xSetSystemCall(original,"openDirectory",(sqlite3_syscall_ptr)at_directory)!=SQLITE_OK)return SQLITE_OK_LOAD_PERMANENTLY;
  HOOK(mkdir,int(*)(const char *,mode_t));HOOK(rmdir,int(*)(const char *));
  prior_lstat=(int(*)(const char *,struct stat *))original->xGetSystemCall(original,"lstat");
  if(prior_lstat && original->xSetSystemCall(original,"lstat",(sqlite3_syscall_ptr)at_lstat)!=SQLITE_OK)return SQLITE_OK_LOAD_PERMANENTLY;
  prior_readlink=(ssize_t(*)(const char *,char *,size_t))original->xGetSystemCall(original,"readlink");
  if(prior_readlink && original->xSetSystemCall(original,"readlink",(sqlite3_syscall_ptr)at_readlink)!=SQLITE_OK)return SQLITE_OK_LOAD_PERMANENTLY;
  setup_status=SQLITE_OK;return SQLITE_OK_LOAD_PERMANENTLY;
}
__attribute__((visibility("default")))
int sqlite3_extension_init(sqlite3 *db,char **error,const sqlite3_api_routines *host) {
  (void)error;pthread_mutex_lock(&initialization);
  int status=initialize(db,host);pthread_mutex_unlock(&initialization);return status;
}
