/* Fixed creator. Only a new no-reuse wildcard socket can become this fence.
 * The creator is one funded holder; EOF/private release returns its own copy.
 * Discovery publishes identity only, never a descriptor or another capability. */
#define _DARWIN_C_SOURCE 1
#include "protocol.h"
#include <bootstrap.h>
#include <sys/socket.h>
#include <sys/proc_info.h>
#include <sys/ptrace.h>
#include <netinet/in.h>
#include <libproc.h>
#include <fcntl.h>
#include <errno.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
static void require(int okay,const char *label){if(!okay){int error=errno;dprintf(3,"E%s: errno=%d\n",label,error);errno=error;perror(label);exit(70);}}
static void kernel(kern_return_t result,const char *label){if(result){dprintf(3,"E%s: kernel=%d\n",label,result);fprintf(stderr,"%s=%d\n",label,result);exit(71);}}
int main(int argc,char **argv){
  if(argc!=3 || getuid()==0 || strlen(argv[1])!=64)return 64;
  struct oma_fence_publication publication={0};
  for(unsigned i=0;i<32;i++){
    char pair[3]={argv[1][2*i],argv[1][2*i+1],0};unsigned value;
    if(strspn(pair,"0123456789abcdef")!=2 || sscanf(pair,"%x",&value)!=1)return 64;
    publication.identity[i]=(uint8_t)value;
  }
  char *end=NULL;errno=0;unsigned long port=strtoul(argv[2],&end,10);
  if(errno || !*argv[2] || *end || port<1024 || port>49151)return 64;
  /* The signed role must retain its new socket even when invoked directly
   * with closed standard FDs; stderr detachment must never replace the fence. */
  for(int standard=0;standard<3;standard++)if(fcntl(standard,F_GETFD)<0){
    require(errno==EBADF,"standard descriptor observation");
    int opened=open("/dev/null",standard==0?O_RDONLY:O_WRONLY);require(opened>=0,"standard descriptor fill");
    if(opened!=standard){require(dup2(opened,standard)==standard,"standard descriptor placement");require(close(opened)==0,"standard descriptor temporary return");}
  }
  int owner_type=0;socklen_t owner_length=sizeof owner_type;
  require(getsockopt(3,SOL_SOCKET,SO_TYPE,&owner_type,&owner_length)==0 && owner_type==SOCK_STREAM,"private owner stream");
  require(ptrace(PT_DENY_ATTACH,0,NULL,0)==0,"deny tracing");
  int fd=socket(AF_INET6,SOCK_DGRAM,0),one=1;
  require(fd>=4,"fence socket");
  require(setsockopt(fd,IPPROTO_IPV6,IPV6_V6ONLY,&one,sizeof one)==0,"fence v6-only");
  struct sockaddr_in6 address={.sin6_len=sizeof address,.sin6_family=AF_INET6,.sin6_port=htons((uint16_t)port)};
  if(bind(fd,(struct sockaddr *)&address,sizeof address)){
    publication.port=(uint32_t)errno;require(close(fd)==0,"failed bind return");
    require(write(3,&publication,sizeof publication)==sizeof publication,"bind refusal frame");return 0;
  }
  publication.port=(uint32_t)port;
  struct sockaddr_in6 peer=address;peer.sin6_addr=in6addr_loopback;
  require(connect(fd,(struct sockaddr *)&peer,sizeof peer)==0,"connect own port");
  int deny=2;require(setsockopt(fd,SOL_SOCKET,0x1081,&deny,sizeof deny)==0,"deny outbound");
  require(shutdown(fd,SHUT_RDWR)==0,"freeze socket");
  require(disconnectx(fd,SAE_ASSOCID_ANY,SAE_CONNID_ANY)==0,"disconnect frozen socket");
  struct socket_fdinfo info={0};
  require(proc_pidfdinfo(getpid(),fd,PROC_PIDFDSOCKETINFO,&info,sizeof info)==sizeof info,"created socket identity");
  publication.socket=info.psi.soi_so;publication.generation=info.psi.soi_proto.pri_in.insi_gencnt;
  publication.info_size=sizeof info;publication.socket_offset=offsetof(struct socket_fdinfo,psi.soi_so);
  publication.generation_offset=offsetof(struct socket_fdinfo,psi.soi_proto.pri_in.insi_gencnt);
  require(publication.socket && publication.generation,"nonzero created instance");
  union{struct cmsghdr align;unsigned char bytes[CMSG_SPACE(sizeof(int))];} control={0};
  struct iovec body={.iov_base=&publication,.iov_len=sizeof publication};
  struct msghdr message={.msg_iov=&body,.msg_iovlen=1,.msg_control=control.bytes,.msg_controllen=sizeof control};
  struct cmsghdr *right=CMSG_FIRSTHDR(&message);right->cmsg_level=SOL_SOCKET;right->cmsg_type=SCM_RIGHTS;right->cmsg_len=CMSG_LEN(sizeof(int));
  memcpy(CMSG_DATA(right),&fd,sizeof fd);
  require(sendmsg(3,&message,0)==sizeof publication,"private fence handoff");
  char name[128];snprintf(name,sizeof name,"org.oma.society-fence.%s",argv[1]);
  mach_port_t discovery=MACH_PORT_NULL;
  kernel(bootstrap_check_in(bootstrap_port,name,&discovery),"fence discovery registration");
  /* The short controller's captured stderr must reach EOF when it returns.
   * Keep setup failures visible, then detach the resident's diagnostic FD. */
  int sink=open("/dev/null",O_WRONLY|O_CLOEXEC);require(sink>=0,"resident stderr");
  require(dup2(sink,2)==2 && close(sink)==0,"resident stderr handback");
  char ready='R';require(write(3,&ready,1)==1,"discovery readiness");
  int flags=fcntl(3,F_GETFL);require(flags>=0 && fcntl(3,F_SETFL,flags|O_NONBLOCK)==0,"owner observation");
  int released=0;
  for(;;){
    char byte=0;ssize_t owner=read(3,&byte,1);
    if(owner==0)break;
    if(owner==1){require(byte=='R',"private release frame");char accepted='R';require(write(3,&accepted,1)==1,"release request acknowledgement");released=1;break;}
    if(owner<0 && errno!=EINTR && errno!=EAGAIN)require(0,"owner lifetime");
    union{uint64_t align;unsigned char bytes[512];} incoming={0};mach_msg_header_t *request=(mach_msg_header_t *)incoming.bytes;
    mach_msg_return_t received=mach_msg(request,MACH_RCV_MSG|MACH_RCV_TIMEOUT,0,sizeof incoming,discovery,10,MACH_PORT_NULL);
    if(received==MACH_RCV_TIMED_OUT)continue;
    kernel(received,"fence discovery request");
    if(request->msgh_id!=OMA_FENCE_QUERY || request->msgh_size!=sizeof(mach_msg_header_t)+16 ||
       request->msgh_bits&MACH_MSGH_BITS_COMPLEX || !MACH_PORT_VALID(request->msgh_remote_port)){
      mach_msg_destroy(request);continue;
    }
    struct oma_fence_answer answer={.publication=publication};
    answer.publication.head=(mach_msg_header_t){.msgh_bits=MACH_MSGH_BITS(MACH_MSG_TYPE_MOVE_SEND,0),.msgh_size=sizeof answer,
      .msgh_remote_port=request->msgh_remote_port,.msgh_id=OMA_FENCE_REPLY};
    memcpy(answer.nonce,incoming.bytes+sizeof *request,16);
    mach_msg_return_t sent=mach_msg(&answer.publication.head,MACH_SEND_MSG|MACH_SEND_TIMEOUT,sizeof answer,0,MACH_PORT_NULL,1000,MACH_PORT_NULL);
    if(sent!=MACH_MSG_SUCCESS){mach_msg_destroy(&answer.publication.head);}
  }
  /* This fixed process ends here. Its discovery receive right is returned by
   * task teardown; do not revoke a bootstrap-owned receive right before the
   * private socket-return acknowledgement can be delivered. */
  require(close(fd)==0,"creator fence return");
  if(released){char closed='C';require(write(3,&closed,1)==1,"fence return acknowledgement");}
  return 0;
}
