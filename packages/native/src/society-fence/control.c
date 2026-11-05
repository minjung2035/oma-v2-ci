/* Trusted fixed-child image selection, private FD handoff and fresh discovery.
 * This program never reads Society state, accepts arbitrary exec, or publishes
 * a fence FD through discovery. Its own alarm only bounds this CLI process. */
#include "protocol.h"
#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <bootstrap.h>
#include <sys/socket.h>
#include <sys/proc_info.h>
#include <sys/wait.h>
#include <sys/time.h>
#include <sys/event.h>
#include <netinet/in.h>
#include <libproc.h>
#include <spawn.h>
#include <signal.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifndef OMA_FENCE_EXPECTED_HASH
#error fixed creator CodeDirectory must be embedded by its owned build recipe
#endif
static volatile sig_atomic_t child;
static void expired(int number){(void)number;if(child>0)kill((pid_t)child,SIGKILL);_exit(72);}
static int observe(int flags,int *status){
  sigset_t blocked,prior;sigemptyset(&blocked);sigaddset(&blocked,SIGALRM);sigaddset(&blocked,SIGTERM);sigaddset(&blocked,SIGINT);
  sigprocmask(SIG_BLOCK,&blocked,&prior);pid_t result=waitpid((pid_t)child,status,flags|WNOHANG);
  if(result==child && (WIFEXITED(*status)||WIFSIGNALED(*status)))child=0;
  if(result<0 && errno==ECHILD)child=0;
  sigprocmask(SIG_SETMASK,&prior,NULL);return(int)result;
}
static void cleanup(void){if(child>0){kill((pid_t)child,SIGKILL);int status;while(child>0){observe(0,&status);usleep(1000);}}}
static void require(int okay,const char *label){if(!okay){perror(label);exit(70);}}
static void kernel(kern_return_t result,const char *label){if(result){fprintf(stderr,"%s=%d\n",label,result);exit(71);}}
static int signed_creator(audit_token_t token,const char *hash){
  CFDataRef data=CFDataCreate(NULL,(const UInt8 *)&token,sizeof token);require(data!=NULL,"audit data");
  const void *keys[]={kSecGuestAttributeAudit},*values[]={data};
  CFDictionaryRef attributes=CFDictionaryCreate(NULL,keys,values,1,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);require(attributes!=NULL,"audit attributes");
  SecCodeRef code=NULL;OSStatus copied=SecCodeCopyGuestWithAttributes(NULL,attributes,kSecCSDefaultFlags,&code);CFRelease(attributes);CFRelease(data);
  char expression[96];snprintf(expression,sizeof expression,"cdhash H\"%s\"",hash);
  CFStringRef text=CFStringCreateWithCString(NULL,expression,kCFStringEncodingUTF8);require(text!=NULL,"code requirement");
  SecRequirementRef requirement=NULL;OSStatus parsed=SecRequirementCreateWithString(text,kSecCSDefaultFlags,&requirement);CFRelease(text);
  OSStatus checked=copied==0 && code && parsed==0 && requirement?SecCodeCheckValidity(code,kSecCSNoNetworkAccess,requirement):errSecCSUnsigned;
  if(code)CFRelease(code);if(requirement)CFRelease(requirement);
  return copied==0 && parsed==0 && checked==0;
}
static void tag_bytes(const char *tag,uint8_t output[32]){
  require(strlen(tag)==64 && strspn(tag,"0123456789abcdef")==64,"full fence tag");
  for(unsigned i=0;i<32;i++){unsigned value;require(sscanf(tag+2*i,"%2x",&value)==1,"fence tag byte");output[i]=(uint8_t)value;}
}
static struct oma_fence_publication discover(const char *tag,const char *hash,unsigned port,audit_token_t *creator){
  mach_port_t service=MACH_PORT_NULL,reply=MACH_PORT_NULL;
  char name[128];snprintf(name,sizeof name,"org.oma.society-fence.%s",tag);
  kernel(bootstrap_look_up(bootstrap_port,name,&service),"fence creator lookup");
  kernel(mach_port_allocate(mach_task_self(),MACH_PORT_RIGHT_RECEIVE,&reply),"fence reply right");
  struct{mach_msg_header_t head;uint8_t nonce[16];} request={0};arc4random_buf(request.nonce,16);
  request.head=(mach_msg_header_t){.msgh_bits=MACH_MSGH_BITS(MACH_MSG_TYPE_COPY_SEND,MACH_MSG_TYPE_MAKE_SEND),.msgh_size=sizeof request,
    .msgh_remote_port=service,.msgh_local_port=reply,.msgh_id=OMA_FENCE_QUERY};
  kernel(mach_msg(&request.head,MACH_SEND_MSG|MACH_SEND_TIMEOUT,sizeof request,0,MACH_PORT_NULL,1000,MACH_PORT_NULL),"fence nonce request");
  union{uint64_t align;unsigned char bytes[512];} received={0};mach_msg_header_t *head=(mach_msg_header_t *)received.bytes;
  kernel(mach_msg(head,MACH_RCV_MSG|MACH_RCV_TIMEOUT|MACH_RCV_TRAILER_TYPE(MACH_MSG_TRAILER_FORMAT_0)|MACH_RCV_TRAILER_ELEMENTS(MACH_RCV_TRAILER_AUDIT),
    0,sizeof received,reply,3000,MACH_PORT_NULL),"fence nonce reply");
  require(head->msgh_id==OMA_FENCE_REPLY && head->msgh_size==sizeof(struct oma_fence_answer) && !(head->msgh_bits&MACH_MSGH_BITS_COMPLEX),"fence reply layout");
  struct oma_fence_answer *answer=(struct oma_fence_answer *)received.bytes;
  mach_msg_audit_trailer_t *trailer=(mach_msg_audit_trailer_t *)(received.bytes+((head->msgh_size+3)&~3));
  uint8_t identity[32];tag_bytes(tag,identity);
  require(trailer->msgh_trailer_size>=sizeof *trailer && trailer->msgh_audit.val[1]==getuid() &&
    !memcmp(answer->nonce,request.nonce,16) && !memcmp(answer->publication.identity,identity,32) && answer->publication.port==port &&
    answer->publication.socket && answer->publication.generation,"fence reply identity");
  require(signed_creator(trailer->msgh_audit,hash),"fence creator mapped image");
  if(creator)*creator=trailer->msgh_audit;
  kernel(mach_port_deallocate(mach_task_self(),service),"creator lookup return");
  kernel(mach_port_mod_refs(mach_task_self(),reply,MACH_PORT_RIGHT_RECEIVE,-1),"private reply return");
  return answer->publication;
}
static unsigned parse_port(const char *text){char *end=NULL;errno=0;unsigned long value=strtoul(text,&end,10);require(!errno && *text && !*end && value>=1024 && value<=49151,"fence port");return(unsigned)value;}
static void deadline(int fd){struct timeval timeout={.tv_sec=3};require(setsockopt(fd,SOL_SOCKET,SO_RCVTIMEO,&timeout,sizeof timeout)==0,"private receive deadline");}
static int acquire(const char *producer,const char *tag,const char *hash,const char *port_text){
  unsigned port=parse_port(port_text);uint8_t identity[32];tag_bytes(tag,identity);
  int lifetime[2];require(socketpair(AF_UNIX,SOCK_STREAM,0,lifetime)==0,"private creator channel");deadline(lifetime[1]);
  posix_spawnattr_t attributes;posix_spawn_file_actions_t actions;
  require(posix_spawnattr_init(&attributes)==0 && posix_spawn_file_actions_init(&actions)==0,"creator spawn setup");
  require(posix_spawnattr_setflags(&attributes,POSIX_SPAWN_START_SUSPENDED|POSIX_SPAWN_CLOEXEC_DEFAULT|POSIX_SPAWN_SETSIGMASK)==0,"creator spawn flags");
  require(posix_spawn_file_actions_adddup2(&actions,lifetime[0],3)==0,"private creator handoff");
  require(posix_spawn_file_actions_addopen(&actions,0,"/dev/null",O_RDONLY,0)==0 && posix_spawn_file_actions_addopen(&actions,1,"/dev/null",O_WRONLY,0)==0 && posix_spawn_file_actions_adddup2(&actions,2,2)==0,"creator stdio");
  char *arguments[]={(char *)producer,(char *)tag,(char *)port_text,NULL},*environment[]={"PATH=/usr/bin:/bin",NULL};pid_t launched=0;
  sigset_t blocked,prior;sigemptyset(&blocked);sigaddset(&blocked,SIGALRM);sigaddset(&blocked,SIGTERM);sigaddset(&blocked,SIGINT);
  require(sigprocmask(SIG_BLOCK,&blocked,&prior)==0,"creator acquisition signal mask");
  require(posix_spawnattr_setsigmask(&attributes,&prior)==0,"creator inherited signal mask");
  int spawned=posix_spawn(&launched,producer,&actions,&attributes,arguments,environment);if(spawned==0)child=launched;
  require(sigprocmask(SIG_SETMASK,&prior,NULL)==0,"creator acquisition signal return");
  require(spawned==0,"direct creator spawn");
  require(posix_spawnattr_destroy(&attributes)==0 && posix_spawn_file_actions_destroy(&actions)==0,"creator setup return");require(close(lifetime[0])==0,"creator child-end return");
  int status=0;pid_t observed=0;
  for(unsigned i=0;i<5000;i++){observed=observe(WUNTRACED,&status);if(observed!=0)break;usleep(1000);}
  require(observed==launched && WIFSTOPPED(status),"unreaped stopped creator");
  mach_port_t task=MACH_PORT_NULL;kernel(task_name_for_pid(mach_task_self(),launched,&task),"creator task-name capability");
  audit_token_t token={0};mach_msg_type_number_t count=TASK_AUDIT_TOKEN_COUNT;
  kernel(task_info(task,TASK_AUDIT_TOKEN,(task_info_t)&token,&count),"creator kernel token");
  require(count==TASK_AUDIT_TOKEN_COUNT && token.val[5]==(unsigned)launched && token.val[1]==getuid() && signed_creator(token,hash),"creator identity before release");
  require(kill(launched,SIGCONT)==0,"unreaped creator release");
  struct oma_fence_publication packet={0};
  union{struct cmsghdr align;unsigned char bytes[CMSG_SPACE(sizeof(int))];} control={0};
  struct iovec body={.iov_base=&packet,.iov_len=sizeof packet};struct msghdr message={.msg_iov=&body,.msg_iovlen=1,.msg_control=control.bytes,.msg_controllen=sizeof control};
  require(recvmsg(lifetime[1],&message,MSG_WAITALL)==sizeof packet && !(message.msg_flags&(MSG_TRUNC|MSG_CTRUNC)),"creator publication");
  struct cmsghdr *right=CMSG_FIRSTHDR(&message);
  if(!right && !packet.socket && !packet.generation){
    int error=(int)packet.port;require(close(lifetime[1])==0,"refused owner channel return");
    while(child>0){observe(0,&status);usleep(1000);}
    kernel(mach_port_deallocate(mach_task_self(),task),"refused creator pin return");
    printf("{\"kind\":\"busy\",\"errno\":%d}\n",error);return 0;
  }
  require(right && right->cmsg_level==SOL_SOCKET && right->cmsg_type==SCM_RIGHTS && right->cmsg_len==CMSG_LEN(sizeof(int)) && !CMSG_NXTHDR(&message,right),"creator publication descriptor");
  int fence=-1;memcpy(&fence,CMSG_DATA(right),sizeof fence);require(fence>=0,"received fence");
  struct socket_fdinfo info={0};
  require(!memcmp(packet.identity,identity,32) && packet.port==port && proc_pidfdinfo(getpid(),fence,PROC_PIDFDSOCKETINFO,&info,sizeof info)==sizeof info &&
    info.psi.soi_so==packet.socket && info.psi.soi_proto.pri_in.insi_gencnt==packet.generation,"actual private fence instance");
  char ready=0;require(read(lifetime[1],&ready,1)==1 && ready=='R',"creator discovery ready");
  audit_token_t discovered={0};struct oma_fence_publication discovery=discover(tag,hash,port,&discovered);
  require(discovery.socket==packet.socket && discovery.generation==packet.generation && !memcmp(&discovered,&token,sizeof token),"fresh creator discovery matches handed fence");
  uint32_t header[2]={OMA_FENCE_HANDOFF,1};int descriptors[2]={fence,lifetime[1]};
  union{struct cmsghdr align;unsigned char bytes[CMSG_SPACE(sizeof descriptors)];} handoff={0};
  struct iovec result={.iov_base=header,.iov_len=sizeof header};struct msghdr returned={.msg_iov=&result,.msg_iovlen=1,.msg_control=handoff.bytes,.msg_controllen=sizeof handoff};
  right=CMSG_FIRSTHDR(&returned);right->cmsg_level=SOL_SOCKET;right->cmsg_type=SCM_RIGHTS;right->cmsg_len=CMSG_LEN(sizeof descriptors);memcpy(CMSG_DATA(right),descriptors,sizeof descriptors);
  require(sendmsg(3,&returned,0)==sizeof header,"private owner handoff");
  require(close(fence)==0 && close(lifetime[1])==0,"controller copies return");
  kernel(mach_port_deallocate(mach_task_self(),task),"creator observation return");
  child=0;puts("{\"kind\":\"held\"}");return 0;
}
int main(int argc,char **argv){
  if(getuid()==0 || argc<2)return 64;
  atexit(cleanup);signal(SIGALRM,expired);signal(SIGTERM,expired);signal(SIGINT,expired);alarm(20);
  if(!strcmp(argv[1],"acquire") && argc==6 && !strcmp(argv[4],OMA_FENCE_EXPECTED_HASH))return acquire(argv[2],argv[3],argv[4],argv[5]);
  if((!strcmp(argv[1],"identify") || !strcmp(argv[1],"holder")) && argc==5 && !strcmp(argv[3],OMA_FENCE_EXPECTED_HASH)){
    unsigned port=parse_port(argv[4]);struct socket_fdinfo info={0};
    int identify=!strcmp(argv[1],"identify");
    if(identify && proc_pidfdinfo(getpid(),3,PROC_PIDFDSOCKETINFO,&info,sizeof info)!=sizeof info){puts("{\"kind\":\"other\"}");return 0;}
    audit_token_t token={0};struct oma_fence_publication creator=discover(argv[2],argv[3],port,&token);
    int matched=!identify || (creator.socket==info.psi.soi_so && creator.generation==info.psi.soi_proto.pri_in.insi_gencnt);
    if(matched)printf("{\"kind\":\"matched\",\"creatorPid\":%u,\"creatorToken\":[%u,%u,%u,%u,%u,%u,%u,%u]}\n",token.val[5],
      token.val[0],token.val[1],token.val[2],token.val[3],token.val[4],token.val[5],token.val[6],token.val[7]);
    else puts("{\"kind\":\"other\"}");return 0;
  }
  if(!strcmp(argv[1],"release") && argc==5 && !strcmp(argv[3],OMA_FENCE_EXPECTED_HASH)){
    audit_token_t before={0},after={0};unsigned port=parse_port(argv[4]);
    (void)discover(argv[2],argv[3],port,&before);
    int queue=kqueue();require(queue>=0,"creator return event queue");
    struct kevent change={0};struct timespec zero={0};
    EV_SET(&change,before.val[5],EVFILT_PROC,EV_ADD|EV_ENABLE|EV_CLEAR,NOTE_EXIT|NOTE_EXITSTATUS,0,NULL);
    require(kevent(queue,&change,1,NULL,0,&zero)==0,"creator return exit registration");
    (void)discover(argv[2],argv[3],port,&after);require(!memcmp(&before,&after,sizeof before),"creator return generation");
    struct socket_fdinfo owner_before={0},creator_before={0},owner_after={0};
    int owner_bytes=proc_pidfdinfo(getpid(),3,PROC_PIDFDSOCKETINFO,&owner_before,sizeof owner_before);
    int creator_bytes=proc_pidfdinfo((pid_t)before.val[5],3,PROC_PIDFDSOCKETINFO,&creator_before,sizeof creator_before);
    deadline(3);char answer=0;errno=0;require(shutdown(3,SHUT_WR)==0,"creator owner send return");
    errno=0;ssize_t received=read(3,&answer,1);
    if(received!=1 || answer!='C'){
      int saved=errno;fprintf(stderr,"creator return acknowledgement: bytes=%zd first=%u errno=%d\n",received,(unsigned char)answer,saved);
      int after_bytes=proc_pidfdinfo(getpid(),3,PROC_PIDFDSOCKETINFO,&owner_after,sizeof owner_after);
      fprintf(stderr,"creator owner sockets: hostBytes=%d creatorBytes=%d afterBytes=%d host=%llu peer=%llu creator=%llu creatorPeer=%llu hostState=%u creatorState=%u afterState=%u\n",
        owner_bytes,creator_bytes,after_bytes,(unsigned long long)owner_before.psi.soi_so,(unsigned long long)owner_before.psi.soi_proto.pri_un.unsi_conn_so,
        (unsigned long long)creator_before.psi.soi_so,(unsigned long long)creator_before.psi.soi_proto.pri_un.unsi_conn_so,
        (unsigned short)owner_before.psi.soi_state,(unsigned short)creator_before.psi.soi_state,(unsigned short)owner_after.psi.soi_state);
      if(received==1 && answer=='E'){char reason[256]={0};ssize_t bytes=read(3,reason,sizeof reason-1);if(bytes>0)fprintf(stderr,"creator failure: %.*s",(int)bytes,reason);}
      struct kevent ended={0};struct timespec bound={.tv_sec=1};errno=0;int events=kevent(queue,NULL,0,&ended,1,&bound);
      fprintf(stderr,"creator return event: count=%d pid=%lu filter=%d flags=%u notes=%u status=%ld errno=%d\n",events,(unsigned long)ended.ident,ended.filter,ended.flags,ended.fflags,(long)ended.data,errno);
      exit(70);
    }
    require(close(queue)==0,"creator return event queue close");
    puts("{\"kind\":\"released\"}");return 0;
  }
  return 64;
}
