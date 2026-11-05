/* Exact private handoff parser. Every received right is returned on refusal. */
#include <sys/socket.h>
#include <stdint.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
int oma_fence_receive(int channel,int *result){
  uint32_t body[2]={0};int received[16],count=0,headers=0,invalid=0;
  union{struct cmsghdr align;unsigned char bytes[CMSG_SPACE(sizeof received)];} control={0};
  struct iovec part={.iov_base=body,.iov_len=sizeof body};
  struct msghdr message={.msg_iov=&part,.msg_iovlen=1,.msg_control=control.bytes,.msg_controllen=sizeof control};
  ssize_t length=recvmsg(channel,&message,MSG_DONTWAIT);
  if(length<0)return errno;
  for(struct cmsghdr *right=CMSG_FIRSTHDR(&message);right;right=CMSG_NXTHDR(&message,right)){
    headers++;
    if(right->cmsg_level!=SOL_SOCKET || right->cmsg_type!=SCM_RIGHTS || right->cmsg_len<CMSG_LEN(0)){invalid=1;continue;}
    size_t bytes=right->cmsg_len-CMSG_LEN(0);
    if(bytes!=sizeof(int))invalid=1;
    for(size_t offset=0;offset+sizeof(int)<=bytes;offset+=sizeof(int)){
      int fd;memcpy(&fd,(unsigned char *)CMSG_DATA(right)+offset,sizeof fd);
      if(count<16)received[count++]=fd;else close(fd);
    }
  }
  if(length==sizeof body && !(message.msg_flags&(MSG_TRUNC|MSG_CTRUNC)) && !invalid && headers==1 && count==1 && body[0]==0x4f4d5373U && body[1]==2){
    result[0]=received[0];return 0;
  }
  for(int i=0;i<count;i++)close(received[i]);return EINVAL;
}
