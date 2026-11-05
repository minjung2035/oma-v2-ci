/* Fixed creator. Only a new no-reuse wildcard socket can become this fence.
 * The Host and enrolled scopes have separate copies. No public request gets
 * a fence descriptor; the enrollment endpoint grants no Actor authority. */
#define _DARWIN_C_SOURCE 1
#include "protocol.h"
#include <bootstrap.h>
#include <sys/socket.h>
#include <sys/proc_info.h>
#include <sys/ptrace.h>
#include <sys/fileport.h>
#include <sys/sysctl.h>
#include <netinet/in.h>
#include <libproc.h>
#include <fcntl.h>
#include <errno.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
static int diagnostic=3;
extern int coalition_info_resource_usage(uint64_t,void *,size_t);
struct retained_scope { uint64_t coalition; struct retained_scope *next; };
static int population(uint64_t coalition){
  uint64_t counts[2]={0};errno=0;int result=coalition_info_resource_usage(coalition,counts,sizeof counts);
  return result==0?1:result==-1 && errno==ESRCH?0:-1;
}
static void require(int okay,const char *label){if(!okay){int error=errno;dprintf(diagnostic,"E%s: errno=%d\n",label,error);errno=error;perror(label);exit(70);}}
static void kernel(kern_return_t result,const char *label){if(result){dprintf(diagnostic,"E%s: kernel=%d\n",label,result);fprintf(stderr,"%s=%d\n",label,result);exit(71);}}
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
  owner_length=sizeof owner_type;
  require(getsockopt(4,SOL_SOCKET,SO_TYPE,&owner_type,&owner_length)==0 && owner_type==SOCK_STREAM,"original Host owner stream");
  int no_pipe=1;require(setsockopt(3,SOL_SOCKET,SO_NOSIGPIPE,&no_pipe,sizeof no_pipe)==0,"private owner closed-peer observation");
  require(setsockopt(4,SOL_SOCKET,SO_NOSIGPIPE,&no_pipe,sizeof no_pipe)==0,"Host owner closed-peer observation");
  require(ptrace(PT_DENY_ATTACH,0,NULL,0)==0,"deny tracing");
  int fd=socket(AF_INET6,SOCK_DGRAM,0),one=1;
  require(fd>=5,"fence socket");
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
  diagnostic=4;
  int flags=fcntl(4,F_GETFL);require(flags>=0 && fcntl(4,F_SETFL,flags|O_NONBLOCK)==0,"owner observation");
  char boot[40]={0};size_t boot_size=sizeof boot;
  require(sysctlbyname("kern.bootsessionuuid",boot,&boot_size,NULL,0)==0 && boot_size==37 && boot[36]==0,"kernel boot identity");
  for(unsigned i=0;i<36;i++)if(boot[i]>='A' && boot[i]<='F')boot[i]+='a'-'A';
  struct retained_scope *scopes=NULL;int scope_fd=-1,owner_ended=0;
  for(;;){
    struct retained_scope **slot=&scopes;
    while(*slot){struct retained_scope *scope=*slot;if(population(scope->coalition)==0){*slot=scope->next;free(scope);}else slot=&scope->next;}
    if(!scopes && scope_fd>=0){require(close(scope_fd)==0,"last scope socket return");scope_fd=-1;}
    if(!owner_ended){
      char byte=0;ssize_t owner=read(4,&byte,1);
      if(owner==0){
        owner_ended=1;require(close(fd)==0,"creator fence return");
        char closed='C';ssize_t returned=write(4,&closed,1);
        require(returned==1 || (returned<0 && errno==EPIPE),"fence return acknowledgement");
      }else{
        if(owner==1)require(0,"unexpected private owner payload");
        if(owner<0 && errno!=EINTR && errno!=EAGAIN)require(0,"owner lifetime");
      }
    }
    if(owner_ended && !scopes)break;
    union{uint64_t align;unsigned char bytes[512];} incoming={0};mach_msg_header_t *request=(mach_msg_header_t *)incoming.bytes;
    mach_msg_return_t received=mach_msg(request,MACH_RCV_MSG|MACH_RCV_TIMEOUT,0,sizeof incoming,discovery,10,MACH_PORT_NULL);
    if(received==MACH_RCV_TIMED_OUT || received==MACH_RCV_INTERRUPTED || received==MACH_RCV_TOO_LARGE)continue;
    if(received!=MACH_MSG_SUCCESS){
      if((received&~0x3e00)==MACH_RCV_BODY_ERROR)mach_msg_destroy(request);
      /* Public traffic or an unanswered receive must never release a live
       * enrolled scope's socket. No failed receive proves scope death. */
      usleep(10000);continue;
    }
    if(!MACH_PORT_VALID(request->msgh_remote_port) || MACH_MSGH_BITS_REMOTE(request->msgh_bits)!=MACH_MSG_TYPE_PORT_SEND){mach_msg_destroy(request);continue;}
    if(request->msgh_id==OMA_FENCE_CHANNEL && request->msgh_size==sizeof(mach_msg_header_t)+16 && !(request->msgh_bits&MACH_MSGH_BITS_COMPLEX)){
      struct oma_fence_channel_answer answer={.publication=publication};
      answer.head=(mach_msg_header_t){.msgh_bits=MACH_MSGH_BITS(MACH_MSG_TYPE_MOVE_SEND,0)|MACH_MSGH_BITS_COMPLEX,
        .msgh_size=sizeof answer,.msgh_remote_port=request->msgh_remote_port,.msgh_id=OMA_FENCE_CHANNEL_REPLY};
      answer.body.msgh_descriptor_count=1;answer.endpoint.name=discovery;answer.endpoint.disposition=MACH_MSG_TYPE_MAKE_SEND;answer.endpoint.type=MACH_MSG_PORT_DESCRIPTOR;
      memcpy(answer.nonce,incoming.bytes+sizeof *request,16);
      mach_msg_return_t sent=mach_msg(&answer.head,MACH_SEND_MSG|MACH_SEND_TIMEOUT,sizeof answer,0,MACH_PORT_NULL,1000,MACH_PORT_NULL);
      if(sent!=MACH_MSG_SUCCESS)mach_msg_destroy(&answer.head);
      continue;
    }
    uint8_t nonce[16];int reply_id=OMA_FENCE_REPLY;
    if(request->msgh_id==OMA_FENCE_ENROLL){
      struct oma_fence_enrollment *enroll=(struct oma_fence_enrollment *)incoming.bytes;
      int valid=request->msgh_size==sizeof *enroll && (request->msgh_bits&MACH_MSGH_BITS_COMPLEX) &&
        enroll->body.msgh_descriptor_count==1 && enroll->proof.type==MACH_MSG_PORT_DESCRIPTOR &&
        enroll->proof.disposition==MACH_MSG_TYPE_PORT_SEND && MACH_PORT_VALID(enroll->proof.name) &&
        MACH_PORT_VALID(request->msgh_remote_port) && !owner_ended && enroll->coalition>0 &&
        !memcmp(enroll->boot,boot,sizeof boot) && population(enroll->coalition)==1;
      int proof=valid?fileport_makefd(enroll->proof.name):-1;struct socket_fdinfo observed={0};
      valid=valid && proof>=0 && proc_pidfdinfo(getpid(),proof,PROC_PIDFDSOCKETINFO,&observed,sizeof observed)==sizeof observed &&
        observed.psi.soi_so==publication.socket && observed.psi.soi_proto.pri_in.insi_gencnt==publication.generation;
      if(proof>=0)require(close(proof)==0,"scope proof descriptor return");
      if(!valid){mach_msg_destroy(request);continue;}
      struct retained_scope *scope=scopes;while(scope && scope->coalition!=enroll->coalition)scope=scope->next;
      if(!scope){
        scope=malloc(sizeof *scope);if(!scope){mach_msg_destroy(request);continue;}
        if(scope_fd<0){scope_fd=fcntl(fd,F_DUPFD_CLOEXEC,5);if(scope_fd<0){free(scope);mach_msg_destroy(request);continue;}}
        scope->coalition=enroll->coalition;scope->next=scopes;scopes=scope;
      }
      memcpy(nonce,enroll->nonce,16);reply_id=OMA_FENCE_ENROLLED;
      kernel(mach_port_deallocate(mach_task_self(),enroll->proof.name),"scope proof port return");
      enroll->proof.name=MACH_PORT_NULL;
    }else if(request->msgh_id!=OMA_FENCE_QUERY || request->msgh_size!=sizeof(mach_msg_header_t)+16 ||
       request->msgh_bits&MACH_MSGH_BITS_COMPLEX || !MACH_PORT_VALID(request->msgh_remote_port)){
      mach_msg_destroy(request);continue;
    }else memcpy(nonce,incoming.bytes+sizeof *request,16);
    struct oma_fence_answer answer={.publication=publication};
    answer.publication.head=(mach_msg_header_t){.msgh_bits=MACH_MSGH_BITS(MACH_MSG_TYPE_MOVE_SEND,0),.msgh_size=sizeof answer,
      .msgh_remote_port=request->msgh_remote_port,.msgh_id=reply_id};
    memcpy(answer.nonce,nonce,16);
    mach_msg_return_t sent=mach_msg(&answer.publication.head,MACH_SEND_MSG|MACH_SEND_TIMEOUT,sizeof answer,0,MACH_PORT_NULL,1000,MACH_PORT_NULL);
    if(sent!=MACH_MSG_SUCCESS){mach_msg_destroy(&answer.publication.head);}
  }
  /* Discovery never exports a descriptor. Unknown scope observations retain
   * the creator's independent copy even after the original Host disappears. */
  return 0;
}
