import { useState, useEffect, useCallback, useRef } from 'react';
import { axios } from '@/library/_axios';
import { getErrorCode, getError } from '@/library/errorCode';

/**
 * 서버 스냅샷에 "진행 중인 하위태스크 상태"를 덮어씌운다.
 *
 * 커밋됐거나 커밋 중인 행이 그 스냅샷에는 아직 반영되지 않았을 수 있다. 그대로 적용하면
 * 방금 바꾼 행이 옛 값으로 되돌아가므로, 오버레이 값이 항상 스냅샷을 이긴다.
 *
 * 오버레이 항목: { status, committed }. 항목 객체 자체가 그 PATCH의 소유권 표식이다.
 * 반환 settled: 이미 커밋됐고(committed) 스냅샷도 같은 값을 주는 항목의 id —
 * 서버가 따라잡았다는 뜻이라 오버레이에서 빼도 안전하다. 수렴 GET이 더 최신 재조회에
 * 밀려 폐기됐을 때 committed 항목이 영구히 남지 않게 하는 안전판이다.
 */
function mergeInFlightSubtasks(serverTask, inFlight) {
  if (!serverTask || inFlight.size === 0 || !Array.isArray(serverTask.subtasks)) {
    return { task: serverTask, settled: [] };
  }
  const settled = [];
  const subtasks = serverTask.subtasks.map((s) => {
    const entry = inFlight.get(s.task_id);
    if (!entry) return s;
    if (entry.committed && s.status === entry.status) {
      settled.push(s.task_id);
      return s;
    }
    return { ...s, status: entry.status };
  });
  return { task: { ...serverTask, subtasks }, settled };
}

export default function useTaskDetail(branchId, taskId) {
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 옵션 데이터
  const [sprints, setSprints] = useState([]);
  const [epics, setEpics] = useState([]);
  const [members, setMembers] = useState([]);
  const [labels, setLabels] = useState([]);
  const [workflowStatuses, setWorkflowStatuses] = useState([]);
  const [taskTypes, setTaskTypes] = useState([]);
  const [customFields, setCustomFields] = useState([]);
  // 이 훅 인스턴스가 낸 task:updated를 자기 리스너가 다시 받아 중복 GET 하는 것을 막는 origin 태그.
  // (같은 realm 안의 객체 아이덴티티 비교라 다른 인스턴스와 충돌하지 않는다.)
  const originRef = useRef({});

  // 진행 중인 하위태스크 상태 변경의 공유 오버레이 { task_id -> { status, committed } }
  // + 진행 중 PATCH 수.
  //
  // 두 행을 빠르게 바꾸면 PATCH 완료 순서가 뒤집힐 수 있다. 먼저 끝난 쪽이 곧바로 상세를
  // 재조회하면 아직 커밋되지 않은 다른 행이 옛 서버 값으로 되돌아오고, 늦게 끝난 쪽의
  // 재조회는 순번에서 밀려 폐기돼 UI가 서버와 어긋난 채 남는다(순번 재배치만으로는 못 막는다).
  // 그래서 두 가지를 함께 건다:
  //   (1) 오버레이의 값은 **모든** 서버 스냅샷을 이긴다(mergeInFlightSubtasks).
  //   (2) 하위태스크 재조회는 진행 중인 PATCH가 전부 끝난 뒤 한 번만 낸다 — 그 GET은
  //       모든 커밋 이후에 나가므로 authoritative하다.
  //
  // 뒷정리는 항목 단위다. 수렴 GET은 **발행 시점에 committed였던 항목만 캡처**하고, 응답이
  // 실제 적용됐을 때 그 항목이 아직 Map에 그대로 있을 때만 지운다(항목 객체의 아이덴티티가
  // 곧 소유권 표식). GET이 나간 뒤 시작된 다른 행의 PATCH는 그 스냅샷에 담기지 않으므로
  // 절대 지워지면 안 되기 때문이다(Map 전체 비우기 금지). 수렴 GET이 폐기돼 캡처분이
  // 남더라도, 이후 어떤 스냅샷이든 서버가 같은 값을 주는 순간 mergeInFlightSubtasks의
  // settled로 빠져 영구 잔존하지 않는다.
  //
  // 태스크를 갈아타면 Map 자체를 새로 갈아끼운다(아래 마운트 이펙트). 이전 화면의 PATCH는
  // 자기가 시작할 때 잡아 둔 Map과 현재 Map이 다른 것으로 세대 교체를 알아채고 물러난다.
  const inFlightSubtaskStatus = useRef(new Map());
  const inFlightSubtaskPatches = useRef(0);

  // 현재 taskId의 task가 화면에 올라왔는지. 최초 로드 전에는 (a) 백그라운드 재조회가
  // 순번을 가져가 최초 GET을 폐기시키면 안 되고, (b) 조용한 실패가 아무 상태도 남기지 않아
  // loading=false / task=null / error=null 인 빈 패널로 굳으면 안 된다.
  const hasTaskRef = useRef(false);

  // 요청 소유권 + 그 화면 전용 응답 순번(owner.seq).
  //
  // owner는 **이 콜백이 만들어진 화면**이고, 같은 branchId/taskId 동안 동일 참조다
  // (대상 태스크가 바뀔 때만 교체 — 렌더마다 새로 만들면 비교가 무의미해진다).
  // 호출 시점의 "현재 화면"을 owner로 읽으면 안 된다: A에서 시작한 저장의 콜백이 B 전환
  // 뒤 후속 fetchTask를 부르면 B를 자기 소유권으로 캡처해 A 응답이 B 화면을 갈아치운다.
  //
  // 순번을 훅 전역에 두면 owner 검사가 있어도 늦다. 떠난 화면의 콜백은 GET을 내지 않더라도
  // **순번을 올리는 것만으로** 현재 화면의 진행 중인 요청을 supersede시킨다(A의 stale
  // refreshTask가 B 최초 GET을 무효화 → 빈 패널). 그래서 순번을 owner에 귀속시킨다:
  // A 콜백은 A owner의 순번만 올리고 B 요청은 B owner의 순번과만 비교하므로, stale 작업이
  // 어느 claim 경로(resync·최초 GET·수렴 GET·담당자·라벨·createLabel의 늦은 claim)로
  // 들어와도 현재 화면을 건드릴 수 없다. 같은 owner 안의 순서 보호는 그대로다.
  const ownerRef = useRef(null);
  if (!ownerRef.current
    || ownerRef.current.branchId !== branchId
    || ownerRef.current.taskId !== taskId) {
    ownerRef.current = { branchId, taskId, seq: 0 };
  }
  const owner = ownerRef.current;
  // 최초 GET이 진행 중일 때 들어온 외부 task:updated. 지금 재조회하면 최초 GET을 폐기시키므로
  // 버리지 말고 적어 뒀다가, 최초 GET이 정리된 뒤 딱 한 번 수렴시킨다.
  const pendingResync = useRef(false);

  // 다른 화면(목록·보드·헤더 등) 갱신용 알림. 변경을 낸 쪽은 이미 스스로 재동기화하므로
  // 자기 리스너는 origin으로 걸러낸다. detail을 읽지 않는 기존 리스너와는 그대로 호환된다.
  const emitTaskUpdated = useCallback(() => {
    window.dispatchEvent(new CustomEvent('task:updated', { detail: { origin: originRef.current } }));
  }, []);

  // silent=true: 변경 저장 후 백그라운드 재동기화용. 스켈레톤/에러로 패널을 갈아끼우지 않아
  // 인라인 편집(서브담당자 멀티선택 등) 중 열린 드롭다운/포커스가 유지된다.
  // seq: 전달 시, 응답 도착 시점에 더 최신 재동기화가 시작됐다면(seq != 현재) 결과를 폐기한다.
  // 반환값: 이 응답이 실제로 반영됐는지(폐기·실패면 false) — 수렴 재조회가 오버레이를
  // 비워도 되는지 판단하는 데 쓴다.
  const fetchTask = useCallback(async ({ silent = false, seq } = {}) => {
    if (!branchId || !taskId) return false;
    // 이 콜백을 만든 화면이 아직 현재 화면인가. 아래 모든 상태 변경이 이 게이트를 통과해야 한다.
    const isCurrent = () => owner === ownerRef.current;
    if (!isCurrent()) return false; // 떠난 화면의 후속 요청 — GET 자체를 내지 않는다
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    let applied = false;
    try {
      const res = await axios.get(`/branches/${branchId}/tasks/${taskId}`);
      // 더 최신 재동기화에 추월됨 — 같은 화면 안에서의 순서 가드.
      const superseded = seq !== undefined && seq !== owner.seq;
      if (isCurrent() && !superseded) {
        if (res.data.status) {
          // 진행 중인 하위태스크 값이 스냅샷을 이긴다 — 커밋 전 상태로 되돌리지 않기 위해.
          const merged = mergeInFlightSubtasks(res.data.task, inFlightSubtaskStatus.current);
          setTask(merged.task);
          setError(null); // 이 화면의 성공은 앞선 실패가 남긴 에러를 정리한다
          hasTaskRef.current = true;
          // 서버가 이미 같은 값을 주는 committed 항목은 역할이 끝났다 — 항목 단위로만 제거.
          merged.settled.forEach((id) => inFlightSubtaskStatus.current.delete(id));
          applied = true;
        } else if (!silent || !hasTaskRef.current) {
          setError(getErrorCode(res.data) ?? 'UNKNOWN_ERROR');
        }
      }
    } catch {
      // 보여 줄 게 아직 없으면 silent라도 에러를 남긴다 — 빈 패널로 굳지 않게.
      // 단 떠난 화면의 요청은 제외 — 새 태스크에 남의 에러를 씌우면 안 된다.
      if (isCurrent() && (!silent || !hasTaskRef.current)) setError('NETWORK_ERROR');
    }
    // 로딩은 현재 화면의 non-silent 요청만 내린다. 이전 세대가 내리면 새 화면이 로딩을
    // 건너뛴 것처럼 보이고, 새 화면의 요청이 어차피 자기 로딩을 정리한다.
    if (!silent && isCurrent()) setLoading(false);
    return applied;
  }, [branchId, taskId, owner]);

  // 백그라운드 재동기화 단일 경로 — 호출 시점에 순번을 claim해, 늦게 도착한 이전 GET이
  // 그 사이 들어온 낙관적 변경을 덮지 못하게 한다. 낙관적 변경을 내는 쪽(담당자·라벨·
  // 하위태스크 상태)은 PATCH 전에 직접 순번을 claim하므로 이 헬퍼를 쓰지 않는다.
  const resync = useCallback(() => {
    const seq = ++owner.seq; // 자기 owner의 순번만 올린다 — 현재 화면의 요청은 건드리지 않는다
    return fetchTask({ silent: true, seq });
  }, [fetchTask, owner]);

  // 자식 섹션(하위태스크 생성 등)이 직접 낸 변경 뒤의 단일 재동기화 경로.
  // 섹션이 스스로 task:updated를 쏘면 이 훅의 리스너가 받아 두 번째 GET을 내므로,
  // 재동기화와 외부 알림을 여기서 한 번에 처리한다.
  const refreshTask = useCallback(async () => {
    await resync();
    emitTaskUpdated();
  }, [resync, emitTaskUpdated]);

  const fetchOptions = useCallback(async () => {
    if (!branchId) return;
    try {
      const [sprintRes, epicRes, memberRes, labelRes, wsRes, typeRes] = await Promise.all([
        axios.get(`/branches/${branchId}/sprints`),
        axios.get(`/branches/${branchId}/epics`),
        axios.get(`/branches/${branchId}/members`),
        axios.get(`/branches/${branchId}/labels`),
        axios.get(`/branches/${branchId}/workflow-statuses`),
        axios.get(`/branches/${branchId}/task-types`),
      ]);
      if (sprintRes.data.status) setSprints(sprintRes.data.sprints);
      if (epicRes.data.status) setEpics(epicRes.data.epics);
      if (memberRes.data.status) setMembers(memberRes.data.members);
      if (labelRes.data.status) setLabels(labelRes.data.labels);
      if (wsRes.data.status) setWorkflowStatuses(wsRes.data.statuses);
      if (typeRes.data.status) setTaskTypes(typeRes.data.task_types);
    } catch {}
  }, [branchId]);

  // task type에 따라 custom fields 가져오기
  const fetchCustomFields = useCallback(async () => {
    if (!branchId || !task?.task_type || taskTypes.length === 0) return;
    const typeConfig = taskTypes.find((t) => t.type_key === task.task_type);
    if (!typeConfig) {
      setCustomFields([]);
      return;
    }
    try {
      const cfRes = await axios.get(`/branches/${branchId}/task-types/${typeConfig.type_id}/custom-fields`);
      if (cfRes.data.status) setCustomFields(cfRes.data.fields);
    } catch {
      setCustomFields([]);
    }
  }, [branchId, task?.task_type, taskTypes]);

  useEffect(() => {
    // 태스크가 바뀌면 새 owner가 만들어지므로 이전 태스크의 in-flight 요청은 자동으로 무효다.
    // 낙관적으로 갱신됐을 수 있는 이전 task와 하위태스크 오버레이를 비운다 — 새 태스크에 남지 않게.
    const seq = ++owner.seq;
    hasTaskRef.current = false;
    pendingResync.current = false;
    inFlightSubtaskStatus.current = new Map(); // 세대 격리 — 이전 화면의 항목을 새 Map으로 떼어낸다
    inFlightSubtaskPatches.current = 0;
    setTask(null);
    fetchTask({ seq }).then(() => {
      // 최초 GET이 진행 중일 때 들어온 알림을 여기서 딱 한 번 소화한다. 최초 응답이 이미
      // 옛 스냅샷일 수 있으므로(요청 시점에 굳는다) 이 재조회가 최신으로 수렴시킨다.
      if (owner !== ownerRef.current || !pendingResync.current) return;
      pendingResync.current = false;
      resync();
    });
    fetchOptions();
  }, [fetchTask, fetchOptions, resync, owner]);

  // 원격 전이(GitHub broadcast_to_branch → Layout이 task:updated emit) 시 열린 패널 본문을 재조회.
  // emit-only였던 task:updated를 여기서 수신한다(현재 보는 task_id로 가드, silent로 포커스 유지).
  // 자기 변경은 이미 순번 붙은 재동기화를 돌렸으므로 origin으로 걸러 중복 GET을 막는다.
  useEffect(() => {
    if (!taskId) return;
    const onTaskUpdated = (e) => {
      if (e.detail?.origin === originRef.current) return;
      // 최초 GET이 아직 진행 중이면 여기서 재조회할 수 없다 — 순번을 가져가 최초 GET을
      // 폐기시키고, 이 조회마저 실패하면 빈 패널만 남는다. 대신 적어 뒀다가 최초 GET이
      // 정리된 뒤 한 번 수렴시킨다(위 마운트 이펙트).
      if (!hasTaskRef.current) {
        pendingResync.current = true;
        return;
      }
      resync();
    };
    window.addEventListener('task:updated', onTaskUpdated);
    return () => window.removeEventListener('task:updated', onTaskUpdated);
  }, [taskId, resync]);

  // task와 taskTypes가 로드된 후 custom fields 가져오기
  useEffect(() => {
    fetchCustomFields();
  }, [fetchCustomFields]);

  // 필드 업데이트 (자동 저장 + 재조회)
  const updateField = async (field, value) => {
    if (!task) return;
    try {
      const payload = { [field]: value };
      const res = await axios.patch(`/branches/${branchId}/tasks/${task.task_id}`, payload);
      if (res.data.status) {
        await fetchTask();
        emitTaskUpdated();
      }
    } catch {}
  };

  // 하위태스크 상태 인라인 변경 (상세 패널 Subtasks 섹션)
  //
  // 진행도 표시(섹션 카운트·진행바·제목 배지)는 전부 task.subtasks에서 파생되므로,
  // 여기서 행 하나를 낙관적으로 갱신하면 세 표시가 같은 렌더에서 함께 움직인다.
  // 섹션 안에 별도 오버레이를 두면 행만 바뀌고 제목 배지는 이전 값을 보여주게 된다.
  //
  // 실패(200 + {status:false} / 네트워크)는 그 행만 이전 상태로 되돌리고 코드를 반환한다.
  // 실패 시엔 재조회하지 않는다 — 서버 값이 곧 prevStatus이기 때문.
  //
  // 여러 행을 동시에 바꾸면 PATCH 완료 순서가 뒤집힐 수 있으므로, 재조회는 진행 중인
  // PATCH가 전부 끝난 뒤 마지막 한 번만 낸다. 그 사이 나가는 다른 재조회(외부 이벤트·
  // 담당자/라벨 변경 등)는 오버레이 병합으로 진행 중인 행을 건드리지 못한다.
  const updateSubtaskStatus = async (subtaskId, nextStatus) => {
    const row = (task?.subtasks || []).find((s) => s.task_id === subtaskId);
    if (!row) return { ok: false, code: 'NOT_FOUND', category: 'not_found' };
    if (row.status === nextStatus) return { ok: true };
    const prevStatus = row.status;
    const setRowStatus = (status) => setTask((prev) => (prev ? {
      ...prev,
      subtasks: (prev.subtasks || []).map((s) => (s.task_id === subtaskId ? { ...s, status } : s)),
    } : prev));

    // 오버레이 항목 객체가 이 요청의 소유권 표식이다 — 뒷정리가 "내가 넣은 그 항목"만
    // 건드리게 해서, 나중에 시작된 다른 PATCH의 항목을 남의 GET이 지우지 못하게 한다.
    // overlay는 시작 시점의 Map — 태스크를 갈아타면 새 Map으로 교체되므로 세대 판별도 겸한다.
    const overlay = inFlightSubtaskStatus.current;
    const entry = { status: nextStatus, committed: false };
    overlay.set(subtaskId, entry);
    inFlightSubtaskPatches.current += 1;
    setRowStatus(nextStatus);

    let failure = null;
    try {
      const res = await axios.patch(`/branches/${branchId}/tasks/${subtaskId}`, { status: nextStatus });
      if (!res.data.status) {
        // 컨트롤러 검증 실패는 200 + {status:false} (silent-200 계약) — 호출부에서 확인
        const err = getError(res.data);
        failure = { ok: false, code: err.code, category: err.category };
      }
    } catch {
      failure = { ok: false, code: 'NETWORK_ERROR', category: null };
    }

    // 그 사이 다른 태스크로 갈아탔다면 오버레이·카운터는 이미 초기화됐다. 이전 화면의
    // 뒷정리를 새 화면에 적용하지 않는다 — 다른 화면 갱신 알림만 남긴다.
    if (overlay !== inFlightSubtaskStatus.current) {
      if (!failure) emitTaskUpdated();
      return failure ?? { ok: true };
    }

    const stillOurs = overlay.get(subtaskId) === entry;
    if (failure) {
      // 실패한 행만 이전 상태로 — 함께 진행 중인 다른 행의 값은 오버레이에 그대로 남는다.
      if (stillOurs) overlay.delete(subtaskId);
      setRowStatus(prevStatus);
    } else if (stillOurs) {
      // 커밋됨 — 이제부터는 서버가 같은 값을 주는 스냅샷을 만나면 오버레이에서 빠질 수 있다.
      entry.committed = true;
    }

    inFlightSubtaskPatches.current -= 1;
    if (inFlightSubtaskPatches.current === 0 && overlay.size > 0) {
      // 배치의 마지막 PATCH가 끝났다. 다른 화면(목록·보드) 갱신 알림도 여기서 한 번만 쏜다 —
      // PATCH마다 쏘면 리스너 9곳이 행 수만큼 재조회해 배치로 묶은 이득이 상쇄된다.
      // 자기 리스너는 origin으로 무시하므로 중복 GET이 되지 않는다.
      emitTaskUpdated();
      // 모든 커밋이 끝난 뒤에 나가는 authoritative 재조회.
      // 이 GET이 수렴시킬 수 있는 것은 "발행 시점에 이미 committed였던" 항목뿐이므로 그것만
      // 캡처한다. GET이 대기하는 동안 시작된 PATCH의 항목은 캡처에 없어 건드리지 못한다.
      const converging = [];
      overlay.forEach((e, id) => { if (e.committed) converging.push([id, e]); });
      const seq = ++owner.seq;
      const applied = await fetchTask({ silent: true, seq });
      if (applied) {
        // 캡처한 그 항목이 아직 그대로인 것만 제거 — 그 사이 같은 행이 다시 바뀌었다면
        // 항목이 교체돼 살아남는다. 적용되지 못했다면(더 최신 재조회가 순번을 가져감)
        // 항목을 유지하고, 이후 스냅샷이 같은 값을 주는 순간 settled로 정리된다.
        converging.forEach(([id, capturedEntry]) => {
          if (overlay.get(id) === capturedEntry) overlay.delete(id);
        });
      }
    }

    return failure ?? { ok: true };
  };

  // 담당자 업데이트
  const updateAssignees = async (mainId, subIds) => {
    if (!task) return;
    // 낙관적 반영: 패널 재로딩 없이 즉시 체크 상태를 갱신해 드롭다운을 연 채로 연속 선택할 수 있고,
    // 직전 선택이 재동기화 전에 유실되는 레이스(빠르게 여러 명 체크)도 막는다. members로 username 등 보강.
    const enrich = (id, role) => ({ ...(members.find((m) => m.user_id === id) || {}), user_id: id, role });
    const optimistic = [
      ...(mainId ? [enrich(mainId, 'main')] : []),
      ...subIds.map((id) => enrich(id, 'sub')),
    ];
    const seq = ++owner.seq; // 이 변경이 최신임을 표시 — 늦게 온 이전 재동기화는 폐기됨
    setTask((prev) => (prev ? { ...prev, assignees: optimistic } : prev));
    try {
      const res = await axios.patch(`/branches/${branchId}/tasks/${task.task_id}`, {
        assignees: { main: mainId || null, sub: subIds },
      });
      // 성공/실패 모두 서버 상태로 조용히 동기화 (실패 시 낙관적 반영이 서버값으로 롤백됨)
      await fetchTask({ silent: true, seq });
      if (res.data.status) {
        emitTaskUpdated();
      }
    } catch {
      await fetchTask({ silent: true, seq });
    }
  };

  // 라벨 토글
  const toggleLabel = async (labelId) => {
    if (!task) return;
    const currentIds = (task.labels || []).map((l) => l.label_id);
    const newIds = currentIds.includes(labelId)
      ? currentIds.filter((id) => id !== labelId)
      : [...currentIds, labelId];
    // 낙관적 반영: 패널 재로딩 없이 즉시 칩을 추가/제거해 라벨 드롭다운을 연 채로 연속 토글할 수 있고,
    // 직전 토글이 재동기화 전에 유실되는 레이스도 막는다. labels(전체)에서 라벨 객체를 보강.
    const optimistic = newIds.map((id) => labels.find((l) => l.label_id === id)).filter(Boolean);
    const seq = ++owner.seq;
    setTask((prev) => (prev ? { ...prev, labels: optimistic } : prev));
    try {
      const res = await axios.patch(`/branches/${branchId}/tasks/${task.task_id}`, { label_ids: newIds });
      await fetchTask({ silent: true, seq });
      if (res.data.status) {
        emitTaskUpdated();
      }
    } catch {
      await fetchTask({ silent: true, seq });
    }
  };

  // 라벨 생성 후 태스크에 할당
  const createLabel = async (labelName, color) => {
    if (!task || !labelName.trim()) return;
    try {
      const body = { label_name: labelName.trim() };
      if (color) body.color = color;
      const res = await axios.post(`/branches/${branchId}/labels`, body);
      if (res.data.status) {
        const newLabelId = res.data.label_id;
        await fetchOptions();
        const currentIds = (task.labels || []).map((l) => l.label_id);
        const patchRes = await axios.patch(`/branches/${branchId}/tasks/${task.task_id}`, {
          label_ids: [...currentIds, newLabelId],
        });
        if (patchRes.data.status) {
          // 생성 직후 다른 라벨을 빠르게 토글하는 경우를 대비해 toggleLabel/updateAssignees와 같은 seq 규약에 합류
          // (여러 await 뒤의 늦은 claim이지만 owner.seq라 떠난 화면의 요청만 무효화한다)
          const seq = ++owner.seq;
          await fetchTask({ silent: true, seq });
          emitTaskUpdated();
        }
      }
    } catch {}
  };

  // 라벨 수정 (색상 변경 등)
  const updateLabel = async (labelId, updates) => {
    try {
      const res = await axios.patch(`/branches/${branchId}/labels/${labelId}`, updates);
      if (res.data.status) {
        await fetchOptions();
        resync();
        emitTaskUpdated();
      }
    } catch {}
  };

  // 브랜치에서 라벨 삭제
  const deleteLabel = async (labelId) => {
    try {
      const res = await axios.delete(`/branches/${branchId}/labels/${labelId}`);
      if (res.data.status) {
        await fetchOptions();
        resync();
        emitTaskUpdated();
      }
    } catch {}
  };

  // 삭제
  const handleDelete = async () => {
    if (!task) return false;
    try {
      const res = await axios.delete(`/branches/${branchId}/tasks/${task.task_id}`);
      if (res.data.status) {
        emitTaskUpdated();
        return true;
      }
    } catch {}
    return false;
  };

  // Select 필드 변경 핸들러
  const handleSelectChange = (field, value) => {
    const parsed = value === '' ? null : (field.endsWith('_id') ? Number(value) : value);
    updateField(field, parsed);
  };

  return {
    task,
    loading,
    error,
    sprints,
    epics,
    members,
    labels,
    workflowStatuses,
    taskTypes,
    customFields,
    refreshTask,
    updateField,
    updateSubtaskStatus,
    updateAssignees,
    toggleLabel,
    createLabel,
    updateLabel,
    deleteLabel,
    handleDelete,
    handleSelectChange,
  };
}
