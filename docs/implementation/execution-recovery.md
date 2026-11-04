# Linux execution journal의 명시적 재부팅 복구

이 절차는 원래 Linux 호스트의 기존 Society에서 execution observation journal이
손상되었거나 없어져 정상 admission이 닫힌 경우를 위한 **Human 운영 명령**이다.
accepted operation이나 receipt의 복구·승인 명령이 아니며 모델 도구로 제공되지 않는다.
macOS 구현과 qualification은 이 변경의 범위가 아니다.

## 안전 조건

- Society UI/host와 broker를 먼저 종료한다. 명령은 Society lease와 broker lock을
  모두 획득해야 한다. 살아 있는 소유자가 있으면 `BROKER_UNAVAILABLE`로 거절한다.
  상속 lease가 남아 있다는 이유로 강제로 잠금을 지우거나 journal을 삭제하지 않는다.
- 원래의 로컬 state filesystem과 Linux 설치에서 진행한다. 경로는 원래 Society와
  같아야 하고 OS의 초기화된 `/etc/machine-id`가 보존되어야 한다. 다른 호스트로 복사한
  state, OS identity가 중복된 clone, snapshot 이주에 대한 scope-death 증명은 아니다.
  machine identity가 없거나 달라지면 복구를 거절한다. hostname이나 시각으로 대체하지 않는다.
- PID 부재, launcher/direct-child 종료, ACK, broker 재시작, container 재시작은 충분한
  증거가 아니다. 준비 때 기록한 커널 boot identity와 다른 실제 호스트 부팅이 필요하다.
- 권한 없는 링크, hardlink, 변경된 원본/보관본, 잘못된 ticket은 실패한다.
  이 경우 증거를 보존하고 원인을 조사한다. `--force`나 unknown-fence 우회 옵션은 없다.

## 실행 순서

1. Society와 broker의 정상 소유권을 해제한다. 강제 종료 신호를 보냈다는 사실만으로
   실행 scope가 죽었다고 간주하지 않는다. 남은 lease가 실제로 해제되지 않으면 준비도 거절한다.
2. 원래 호스트에서 준비한다.

   ```sh
   oma recover-execution --society my-society --prepare
   ```

   별도 configuration을 사용했다면 `--config /absolute/path/config.json`을 함께 지정하고,
   적용 때도 같은 configuration을 사용한다. 존재하지 않는 Society/ledger는 만들지 않는다.
3. 준비는 원본 `execution/scopes.jsonl`의 정확한 bytes를 SHA-256 이름의 보관본으로
   fsync하고 `execution/recovery.json`을 durable publication한다. 원본이 없었다면 그
   부재를 기록할 뿐 아직 새 journal을 만들지 않는다. accepted work는 변경하지 않는다.
   ticket이 존재하는 동안 journal open/initialize 및 새 scope admission은 닫힌다.
4. **이 Linux 호스트를 실제로 재부팅한다.** 이 문서나 OMA 명령 자체가 재부팅을
   수행하지는 않는다. 부팅 후에도 Society/broker가 복구 적용과 동시에 소유권을 잡지 않게 한다.
5. 같은 호스트와 state 경로에서 적용한다.

   ```sh
   oma recover-execution --society my-society --apply
   ```

   같은 boot라면 `RUN_TERMINATION_UNKNOWN`을 유지한다. 다른 boot라도 host/root binding,
   원본 digest와 보관본 검증이 맞지 않으면 reset하지 않는다.
6. 적용 성공 후 Society를 평소 방식으로 resume한다. 원본 보관본은 남는다. acceptance,
   request key, frozen plan, receipt, approval, canonical main 및 완료 상태는 바꾸지 않는다.
   pending work는 각 기존 owner의 정상 검증과 recovery를 계속 거쳐야 한다.

## 중단과 반복

- 준비를 반복해도 기존 ticket의 boot identity를 오늘 값으로 덮어쓰지 않는다.
- reset의 초기 frame을 durable하게 쓴 뒤 ticket 제거 전에 중단되면 admission은 계속
  닫힌다. 같은 `--apply`를 반복하면 정확히 그 초기 frame과 기존 보관본을 검증해 마무리한다.
- 중단 뒤 임의 frame이 추가되거나 원본이 다른 bytes로 바뀌었다면 자동으로 정규화하지 않는다.
- 이 구현의 changed-boot 경로는 제어된 kernel-observation fixture로 시험했다.
  실제 CLI의 lock 거절·동일 boot 거절·accepted plan 보존도 시험했지만,
  개발 호스트 자체를 재부팅한 qualification은 수행하지 않았다.

구현과 최신 실행 범위는 [validation](validation.md),
[구현 계약](architecture-improvements.md)에 기록한다.
