/* Direct, unreaped fixed child only. No launchd job or Society state journal.
 * This candidate does not establish owner-loss or a product lease protocol. */
#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <mach/mach.h>
#include <mach/task_special_ports.h>
#include <bootstrap.h>
#include <sys/proc_info.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <netinet/in.h>
#include <libproc.h>
#include <spawn.h>
#include <signal.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

extern int fileport_makefd(mach_port_t);
static volatile sig_atomic_t child,expired;
static void interrupted(int number){expired=number;if(child>0)(void)kill((pid_t)child,SIGKILL);}
static int observe(int flags,int *status){
  sigset_t block,prior;sigemptyset(&block);sigaddset(&block,SIGALRM);sigaddset(&block,SIGTERM);sigaddset(&block,SIGINT);
  sigprocmask(SIG_BLOCK,&block,&prior);
  pid_t result=waitpid((pid_t)child,status,flags|WNOHANG);
  if(result==child && (WIFEXITED(*status)||WIFSIGNALED(*status)))child=0;
  if(result<0 && errno==ECHILD)child=0;
  sigprocmask(SIG_SETMASK,&prior,NULL);return (int)result;
}
static void cleanup(void){if(child>0){(void)kill((pid_t)child,SIGKILL);int status;while(child>0){(void)observe(0,&status);usleep(1000);}}}
static void require(int okay,const char *message){if(!okay){perror(message);exit(70);}}
static void mach_ok(kern_return_t status,const char *message){if(status){fprintf(stderr,"%s=%d\n",message,status);exit(71);}}
static int signed_child(audit_token_t token,const char *hash){
  CFDataRef data=CFDataCreate(NULL,(const UInt8 *)&token,sizeof token);require(data!=NULL,"audit data");
  const void *keys[]={kSecGuestAttributeAudit},*values[]={data};
  CFDictionaryRef attributes=CFDictionaryCreate(NULL,keys,values,1,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);require(attributes!=NULL,"audit attributes");
  SecCodeRef code=NULL;OSStatus copied=SecCodeCopyGuestWithAttributes(NULL,attributes,kSecCSDefaultFlags,&code);CFRelease(attributes);CFRelease(data);
  char expression[96];snprintf(expression,sizeof expression,"cdhash H\"%s\"",hash);
  CFStringRef text=CFStringCreateWithCString(NULL,expression,kCFStringEncodingUTF8);require(text!=NULL,"requirement text");SecRequirementRef requirement=NULL;
  OSStatus parsed=SecRequirementCreateWithString(text,kSecCSDefaultFlags,&requirement);CFRelease(text);
  OSStatus checked=copied==0 && code!=NULL && parsed==0 && requirement!=NULL?SecCodeCheckValidity(code,kSecCSNoNetworkAccess,requirement):errSecCSUnsigned;
  if(code)CFRelease(code);
  if(requirement)CFRelease(requirement);
  fprintf(stderr,"{\"copy\":%d,\"parse\":%d,\"check\":%d}\n",copied,parsed,checked);return copied==0 && parsed==0 && checked==0;
}
struct publication{mach_msg_header_t head;uint8_t identity[32];uint64_t socket,generation;uint32_t port,info_size,socket_offset,generation_offset;};
_Static_assert(sizeof(struct publication)==88,"fixed producer body");
static int bound(uint16_t port){
  int fd=socket(AF_INET6,SOCK_DGRAM,0),one=1;require(fd>=0,"contender socket");require(setsockopt(fd,IPPROTO_IPV6,IPV6_V6ONLY,&one,sizeof one)==0,"contender v6");
  struct sockaddr_in6 address={.sin6_len=sizeof address,.sin6_family=AF_INET6,.sin6_port=htons(port)};
  int result=bind(fd,(struct sockaddr *)&address,sizeof address),error=errno;require(close(fd)==0,"contender close");return result==0?0:error;
}
int main(int argc,char **argv){
  int discovery_peer=argc==5 && !strcmp(argv[4],"bootstrap-discovery");
  if((argc!=4 && !discovery_peer) || getuid()==0 || strlen(argv[2])!=64 || strlen(argv[3])!=40)return 64;
  atexit(cleanup);signal(SIGALRM,interrupted);signal(SIGTERM,interrupted);signal(SIGINT,interrupted);alarm(20);
  mach_port_t endpoint=MACH_PORT_NULL;mach_ok(mach_port_allocate(mach_task_self(),MACH_PORT_RIGHT_RECEIVE,&endpoint),"receive right");mach_ok(mach_port_insert_right(mach_task_self(),endpoint,endpoint,MACH_MSG_TYPE_MAKE_SEND),"peer send right");
  int lifetime[2];require((discovery_peer?socketpair(AF_UNIX,SOCK_STREAM,0,lifetime):pipe(lifetime))==0,"private lifetime channel");posix_spawnattr_t attributes;posix_spawn_file_actions_t actions;
  require(posix_spawnattr_init(&attributes)==0 && posix_spawn_file_actions_init(&actions)==0,"spawn setup");
  require(posix_spawnattr_setflags(&attributes,POSIX_SPAWN_START_SUSPENDED|POSIX_SPAWN_CLOEXEC_DEFAULT)==0,"spawn flags");
  if(!discovery_peer)require(posix_spawnattr_setspecialport_np(&attributes,endpoint,TASK_BOOTSTRAP_PORT)==0,"private child special-port peer");
  require(posix_spawn_file_actions_adddup2(&actions,lifetime[0],3)==0,"lifetime handoff");
  require(posix_spawn_file_actions_addopen(&actions,0,"/dev/null",O_RDONLY,0)==0 && posix_spawn_file_actions_addopen(&actions,1,"/dev/null",O_WRONLY,0)==0 && posix_spawn_file_actions_adddup2(&actions,2,2)==0,"private stdio");
  char *arguments[]={argv[1],argv[2],"0",discovery_peer?"bootstrap-discovery":"bootstrap-peer",NULL},*environment[]={"PATH=/usr/bin:/bin",NULL};pid_t launched=0;
  require(posix_spawn(&launched,argv[1],&actions,&attributes,arguments,environment)==0,"direct spawn");child=launched;
  require(posix_spawn_file_actions_destroy(&actions)==0 && posix_spawnattr_destroy(&attributes)==0,"spawn setup return");require(close(lifetime[0])==0,"parent read return");
  int status=0,result=0;for(unsigned i=0;i<5000 && !expired;i++){result=observe(WUNTRACED,&status);if(result!=0)break;usleep(1000);}require(result==launched && WIFSTOPPED(status),"suspended direct child");
  mach_port_t task=MACH_PORT_NULL;mach_ok(task_name_for_pid(mach_task_self(),launched,&task),"child task name");audit_token_t token={0};mach_msg_type_number_t count=TASK_AUDIT_TOKEN_COUNT;mach_ok(task_info(task,TASK_AUDIT_TOKEN,(task_info_t)&token,&count),"child audit token");require(count==TASK_AUDIT_TOKEN_COUNT && token.val[5]==(unsigned)launched && token.val[1]==getuid(),"child token identity");
  int matched=signed_child(token,argv[3]);require(!expired,"controller deadline");
  if(!matched){require(kill((pid_t)child,SIGKILL)==0,"unreaped refusal");while(child>0){(void)observe(0,&status);usleep(1000);}printf("{\"matched\":false,\"released\":false,\"childReaped\":true}\n");return 0;}
  require(kill((pid_t)child,SIGCONT)==0,"unreaped release");
  union{uint64_t alignment;unsigned char bytes[1024];} message={0};struct publication packet={0};audit_token_t sender={0};int received=0;
  int socket_fd=-1;
  if(discovery_peer){
    union {struct cmsghdr align;unsigned char bytes[CMSG_SPACE(sizeof(int))];} control={0};
    struct iovec body={.iov_base=&packet,.iov_len=sizeof packet};
    struct msghdr publication={.msg_iov=&body,.msg_iovlen=1,.msg_control=control.bytes,.msg_controllen=sizeof control};
    require(recvmsg(lifetime[1],&publication,MSG_WAITALL)==sizeof packet && !(publication.msg_flags&(MSG_TRUNC|MSG_CTRUNC)),"direct publication frame");
    struct cmsghdr *right=CMSG_FIRSTHDR(&publication);
    require(right && right->cmsg_level==SOL_SOCKET && right->cmsg_type==SCM_RIGHTS && right->cmsg_len==CMSG_LEN(sizeof(int)) && CMSG_NXTHDR(&publication,right)==NULL,"direct publication descriptor");
    memcpy(&socket_fd,CMSG_DATA(right),sizeof socket_fd);require(socket_fd>=0,"direct publication socket");
    require(observe(0,&status)==0,"unreaped authenticated producer");received=1;
  }else for(unsigned i=0;i<20 && !expired;i++){
    memset(&message,0,sizeof message);mach_msg_header_t *head=(mach_msg_header_t *)message.bytes;
    mach_msg_return_t answer=mach_msg(head,MACH_RCV_MSG|MACH_RCV_TIMEOUT|MACH_RCV_TRAILER_TYPE(MACH_MSG_TRAILER_FORMAT_0)|MACH_RCV_TRAILER_ELEMENTS(MACH_RCV_TRAILER_AUDIT),0,sizeof message,endpoint,500,MACH_PORT_NULL);
    if(answer==MACH_RCV_TIMED_OUT)continue;mach_ok(answer,"producer message");
    if(head->msgh_id!=0x4f4d4170 || head->msgh_size!=sizeof packet){mach_msg_destroy(head);continue;}
    mach_msg_audit_trailer_t *trailer=(mach_msg_audit_trailer_t *)(message.bytes+((head->msgh_size+3)&~3));require(trailer->msgh_trailer_size>=sizeof *trailer,"kernel trailer");packet=*(struct publication *)head;sender=trailer->msgh_audit;received=1;break;
  }
  require(received && (discovery_peer || !memcmp(&sender,&token,sizeof token)),"actual producer sender");
  for(unsigned i=0;i<32;i++){unsigned byte;require(sscanf(argv[2]+2*i,"%2x",&byte)==1 && packet.identity[i]==byte,"full tag");}
  if(!discovery_peer){socket_fd=fileport_makefd(packet.head.msgh_remote_port);require(socket_fd>=0,"received socket");mach_ok(mach_port_deallocate(mach_task_self(),packet.head.msgh_remote_port),"received fileport return");}
  struct socket_fdinfo info={0};require(proc_pidfdinfo(getpid(),socket_fd,PROC_PIDFDSOCKETINFO,&info,sizeof info)==sizeof info && info.psi.soi_so==packet.socket && info.psi.soi_proto.pri_in.insi_gencnt==packet.generation,"kernel socket instance");
  if(discovery_peer){
    char ready=0;require(read(lifetime[1],&ready,1)==1 && ready=='R',"direct producer discovery readiness");
    char name[128];snprintf(name,sizeof name,"org.oma.direct-fence.%s",argv[2]);mach_port_t service=MACH_PORT_NULL;
    mach_ok(bootstrap_look_up(bootstrap_port,name,&service),"normal-bootstrap discovery");
    struct {mach_msg_header_t head;uint8_t nonce[16];} challenge={0};arc4random_buf(challenge.nonce,sizeof challenge.nonce);
    challenge.head=(mach_msg_header_t){.msgh_bits=MACH_MSGH_BITS(MACH_MSG_TYPE_COPY_SEND,MACH_MSG_TYPE_MAKE_SEND),.msgh_size=sizeof challenge,.msgh_remote_port=service,.msgh_local_port=endpoint,.msgh_id=0x4f4d4171};
    mach_ok(mach_msg(&challenge.head,MACH_SEND_MSG|MACH_SEND_TIMEOUT,sizeof challenge,0,MACH_PORT_NULL,1000,MACH_PORT_NULL),"fresh discovery challenge");
    memset(&message,0,sizeof message);mach_msg_header_t *head=(mach_msg_header_t *)message.bytes;
    mach_ok(mach_msg(head,MACH_RCV_MSG|MACH_RCV_TIMEOUT|MACH_RCV_TRAILER_TYPE(MACH_MSG_TRAILER_FORMAT_0)|MACH_RCV_TRAILER_ELEMENTS(MACH_RCV_TRAILER_AUDIT),0,sizeof message,endpoint,5000,MACH_PORT_NULL),"discovery response");
    require(head->msgh_id==0x4f4d4172 && head->msgh_size==sizeof packet,"discovery response layout");
    struct publication *response=(struct publication *)head;mach_msg_audit_trailer_t *trailer=(mach_msg_audit_trailer_t *)(message.bytes+((head->msgh_size+3)&~3));
    require(trailer->msgh_trailer_size>=sizeof *trailer && !memcmp(&trailer->msgh_audit,&token,sizeof token),"discovery kernel sender");
    require(!memcmp(response->identity,packet.identity,32) && response->socket==packet.socket && response->generation==packet.generation && !memcmp(&response->port,challenge.nonce,16),"fresh discovery instance");
    mach_ok(mach_port_deallocate(mach_task_self(),service),"discovery send return");
  }
  require(observe(0,&status)==0 && bound((uint16_t)packet.port)==EADDRINUSE,"creator-live held binding");require(close(socket_fd)==0,"last socket return");require(bound((uint16_t)packet.port)==0 && observe(0,&status)==0,"creator-live last close");
  require(close(lifetime[1])==0,"lifetime EOF");while(child>0 && !expired){(void)observe(0,&status);usleep(1000);}require(child==0 && WIFEXITED(status) && WEXITSTATUS(status)==0,"direct producer return");
  mach_ok(mach_port_deallocate(mach_task_self(),task),"child task return");mach_ok(mach_port_deallocate(mach_task_self(),endpoint),"peer send return");mach_ok(mach_port_mod_refs(mach_task_self(),endpoint,MACH_PORT_RIGHT_RECEIVE,-1),"peer receive return");
  printf("{\"matched\":true,\"released\":true,\"kernelSender\":true,\"instanceMatched\":true,\"creatorLiveAcrossLastClose\":true,\"childReaped\":true%s}\n",discovery_peer?",\"discoveryAuthenticated\":true,\"directChannel\":true":"");return 0;
}
