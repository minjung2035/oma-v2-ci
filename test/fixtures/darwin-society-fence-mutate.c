#define _DARWIN_C_SOURCE 1
#include <sys/socket.h>
#include <netinet/in.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
int main(void){
  int one=1,zero=0;
  struct sockaddr_in6 address={.sin6_len=sizeof address,.sin6_family=AF_INET6};
  struct sockaddr unspec={.sa_len=sizeof unspec,.sa_family=AF_UNSPEC};
  puts("[");
#define OBSERVE(label,call) do{errno=0;int result=(call),error=errno;printf("{\"operation\":\"%s\",\"result\":%d,\"errno\":%d},\n",label,result,error);}while(0)
  OBSERVE("bind-port-zero",bind(3,(struct sockaddr *)&address,sizeof address));
  OBSERVE("bind-unspecified",bind(3,&unspec,sizeof unspec));
  OBSERVE("reuse-address",setsockopt(3,SOL_SOCKET,SO_REUSEADDR,&one,sizeof one));
  OBSERVE("reuse-port",setsockopt(3,SOL_SOCKET,SO_REUSEPORT,&one,sizeof one));
  OBSERVE("clear-v6-only",setsockopt(3,IPPROTO_IPV6,IPV6_V6ONLY,&zero,sizeof zero));
  OBSERVE("clear-restrictions",setsockopt(3,SOL_SOCKET,0x1081,&zero,sizeof zero));
  address.sin6_addr=in6addr_loopback;address.sin6_port=htons(9);
  OBSERVE("connect-another-port",connect(3,(struct sockaddr *)&address,sizeof address));
  OBSERVE("connect-unspecified",connect(3,&unspec,sizeof unspec));
  OBSERVE("disconnect",disconnectx(3,SAE_ASSOCID_ANY,SAE_CONNID_ANY));
  OBSERVE("shutdown",shutdown(3,SHUT_RDWR));
  puts("{\"complete\":true}]");return 0;
}
