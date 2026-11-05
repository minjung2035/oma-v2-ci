/* Own held source/parent only. No product copy policy or pathname reopen. */
#include <sys/clonefile.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
int main(void) {
  int result=fclonefileat(3,4,"copy",CLONE_NOOWNERCOPY),error=errno;
  struct stat source={0},target={0};int observed=0,fd=-1;
  if(!result){
    fd=openat(4,"copy",O_RDONLY|O_NOFOLLOW|O_CLOEXEC);
    if(fd>=0 && !fstat(3,&source) && !fstat(fd,&target))observed=1;
  }
  printf("{\"result\":%d,\"error\":%d,\"observed\":%s,\"differentInode\":%s,\"links\":%llu,\"flags\":%u}\n",
    result,error,observed?"true":"false",observed&&(source.st_dev!=target.st_dev||source.st_ino!=target.st_ino)?"true":"false",
    (unsigned long long)target.st_nlink,target.st_flags);
  if(fd>=0 && close(fd))return 2;
  return 0;
}
