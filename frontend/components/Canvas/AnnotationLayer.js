import { useState, useEffect, useCallback, useRef } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * DOM 노드 경로 계산: contentRef 기준으로 태그:인덱스 형태
 * 예: "p:3", "h2:1>p:0"
 */
function computeAnchorPath(node, root) {
  const parts = [];
  let current = node;
  while (current && current !== root && current.parentNode) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const tag = current.tagName.toLowerCase();
      const siblings = Array.from(current.parentNode.children).filter(
        (el) => el.tagName === current.tagName
      );
      const index = siblings.indexOf(current);
      parts.unshift(`${tag}:${index}`);
    } else if (current.nodeType === Node.TEXT_NODE) {
      // 텍스트 노드는 건너뛰고 부모로
    }
    current = current.parentNode;
  }
  return parts.join('>');
}

/**
 * 선택 범위 주변 컨텍스트(앞뒤 50자) 추출
 */
function getContext(range, root) {
  const fullText = root.textContent || '';
  const selectedText = range.toString();

  // 선택 시작 지점까지의 텍스트 길이 계산
  const preRange = document.createRange();
  preRange.setStart(root, 0);
  preRange.setEnd(range.startContainer, range.startOffset);
  const preText = preRange.toString();
  const startIdx = preText.length;

  const prefix = fullText.slice(Math.max(0, startIdx - 50), startIdx);
  const suffix = fullText.slice(startIdx + selectedText.length, startIdx + selectedText.length + 50);

  return { prefix, suffix };
}

/**
 * anchor_node_path + offset으로 텍스트 위치 찾기 (1차 시도)
 */
function findByPath(contentEl, nodePath, offset, length) {
  if (!nodePath) return null;
  const parts = nodePath.split('>');
  let current = contentEl;

  for (const part of parts) {
    const [tag, idxStr] = part.split(':');
    const idx = parseInt(idxStr, 10);
    const children = Array.from(current.children).filter(
      (el) => el.tagName.toLowerCase() === tag
    );
    if (children[idx]) {
      current = children[idx];
    } else {
      return null;
    }
  }

  // 텍스트 노드 내에서 offset 위치 찾기
  const walker = document.createTreeWalker(current, NodeFilter.SHOW_TEXT);
  let charCount = 0;
  let node;
  while ((node = walker.nextNode())) {
    const nodeLen = node.textContent.length;
    if (charCount + nodeLen >= offset) {
      const localOffset = offset - charCount;
      // 범위가 이 텍스트 노드 안에 들어가는지 확인
      const availableLen = nodeLen - localOffset;
      if (availableLen >= length) {
        try {
          const range = document.createRange();
          range.setStart(node, localOffset);
          range.setEnd(node, localOffset + length);
          return range;
        } catch {
          return null;
        }
      }
      // 여러 텍스트 노드에 걸치는 경우 → 간단히 시작만 반환
      try {
        const range = document.createRange();
        range.setStart(node, localOffset);
        range.setEnd(node, nodeLen);
        return range;
      } catch {
        return null;
      }
    }
    charCount += nodeLen;
  }
  return null;
}

/**
 * 텍스트 검색으로 위치 찾기 (2차/3차 폴백)
 */
function findByTextSearch(contentEl, quotedText, prefix, suffix) {
  const fullText = contentEl.textContent || '';

  // 2차: prefix + quoted + suffix 패턴 검색
  if (prefix || suffix) {
    const searchPattern = (prefix || '') + quotedText + (suffix || '');
    const patternIdx = fullText.indexOf(searchPattern);
    if (patternIdx >= 0) {
      const startIdx = patternIdx + (prefix || '').length;
      return findRangeByTextOffset(contentEl, startIdx, quotedText.length);
    }
  }

  // 3차: quotedText만으로 검색
  const textIdx = fullText.indexOf(quotedText);
  if (textIdx >= 0) {
    return findRangeByTextOffset(contentEl, textIdx, quotedText.length);
  }

  return null;
}

/**
 * 전체 텍스트 오프셋으로 DOM Range 생성
 */
function findRangeByTextOffset(root, globalOffset, length) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let charCount = 0;
  let startNode = null, startOffset = 0;
  let endNode = null, endOffset = 0;
  let node;

  while ((node = walker.nextNode())) {
    const nodeLen = node.textContent.length;

    if (!startNode && charCount + nodeLen > globalOffset) {
      startNode = node;
      startOffset = globalOffset - charCount;
    }

    if (startNode && charCount + nodeLen >= globalOffset + length) {
      endNode = node;
      endOffset = globalOffset + length - charCount;
      break;
    }

    charCount += nodeLen;
  }

  if (!startNode || !endNode) return null;

  try {
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    return range;
  } catch {
    return null;
  }
}

/**
 * annotation의 앵커 위치를 DOM에서 찾고 래핑 + Y좌표 반환
 */
function anchorAnnotation(contentEl, annotation) {
  // 1차: path + offset
  let range = findByPath(
    contentEl,
    annotation.anchor_node_path,
    annotation.anchor_offset,
    annotation.anchor_length
  );

  // 2차/3차: 텍스트 검색
  if (!range) {
    range = findByTextSearch(
      contentEl,
      annotation.quoted_text,
      annotation.prefix_context,
      annotation.suffix_context
    );
  }

  if (!range) {
    return { found: false, top: 0 };
  }

  // 텍스트를 span으로 래핑
  try {
    const span = document.createElement('span');
    span.className = 'annotation-anchor';
    span.dataset.annotationId = String(annotation.annotation_id);
    range.surroundContents(span);
    const rect = span.getBoundingClientRect();
    const containerRect = contentEl.getBoundingClientRect();
    return { found: true, top: rect.top - containerRect.top + contentEl.scrollTop };
  } catch {
    // surroundContents 실패 시 (여러 요소에 걸치는 경우) → 시작 위치만 활용
    const rect = range.getBoundingClientRect();
    const containerRect = contentEl.getBoundingClientRect();
    return { found: true, top: rect.top - containerRect.top + contentEl.scrollTop };
  }
}


export default function AnnotationLayer({
  contentRef,
  annotations,
  isEditing,
  pageContent,
  onCreateAnnotation,
  activeAnnotationId,
  onAnnotationClick,
}) {
  const { t } = useTranslation();
  const [markerPositions, setMarkerPositions] = useState([]);
  const [floatingBtn, setFloatingBtn] = useState(null); // { x, y, anchorData }
  const floatingBtnRef = useRef(null);

  // 앵커 위치 계산 + DOM 래핑
  useEffect(() => {
    if (isEditing || !contentRef.current || !annotations.length) {
      setMarkerPositions([]);
      return;
    }

    // 기존 래핑 제거
    contentRef.current.querySelectorAll('.annotation-anchor').forEach((el) => {
      const parent = el.parentNode;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    });

    // 래핑 + 위치 계산
    const positions = [];
    for (const ann of annotations) {
      const result = anchorAnnotation(contentRef.current, ann);
      positions.push({
        annotation_id: ann.annotation_id,
        found: result.found,
        top: result.top,
        status: ann.status,
      });
    }

    setMarkerPositions(positions);
  }, [isEditing, annotations, pageContent, contentRef]);

  // 마커 hover → 해당 텍스트 하이라이트
  const handleMarkerHover = useCallback((annotationId, isHover) => {
    if (!contentRef.current) return;
    const span = contentRef.current.querySelector(
      `.annotation-anchor[data-annotation-id="${annotationId}"]`
    );
    if (span) {
      if (isHover) {
        span.classList.add('annotation-anchor--hover');
      } else {
        span.classList.remove('annotation-anchor--hover');
      }
    }
  }, [contentRef]);

  // 텍스트 선택 감지 → 플로팅 버튼 표시
  useEffect(() => {
    if (isEditing || !contentRef.current) return;

    const handleMouseUp = (e) => {
      // 플로팅 버튼 클릭 시 무시
      if (floatingBtnRef.current && floatingBtnRef.current.contains(e.target)) return;

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) {
        setFloatingBtn(null);
        return;
      }

      // 선택이 contentRef 안에 있는지 확인
      const range = selection.getRangeAt(0);
      if (!contentRef.current.contains(range.commonAncestorContainer)) {
        setFloatingBtn(null);
        return;
      }

      const selectedText = selection.toString().trim();
      if (!selectedText || selectedText.length > 2000) {
        setFloatingBtn(null);
        return;
      }

      const rect = range.getBoundingClientRect();
      const { prefix, suffix } = getContext(range, contentRef.current);

      // 시작 노드의 부모 요소로 path 계산
      let pathNode = range.startContainer;
      if (pathNode.nodeType === Node.TEXT_NODE) pathNode = pathNode.parentElement;
      const nodePath = computeAnchorPath(pathNode, contentRef.current);

      // 텍스트 노드 내 오프셋 계산
      let offset = range.startOffset;
      if (range.startContainer.nodeType === Node.TEXT_NODE) {
        // 같은 부모 내 이전 텍스트 노드들의 길이 합산
        const walker = document.createTreeWalker(pathNode, NodeFilter.SHOW_TEXT);
        let charCount = 0;
        let node;
        while ((node = walker.nextNode())) {
          if (node === range.startContainer) {
            offset = charCount + range.startOffset;
            break;
          }
          charCount += node.textContent.length;
        }
      }

      // CanvasPageView__Body (position: relative) 기준 좌표
      const bodyEl = contentRef.current.closest('.CanvasPageView__Body') || contentRef.current.parentElement;
      const bodyRect = bodyEl.getBoundingClientRect();

      setFloatingBtn({
        x: rect.right - bodyRect.left + 8,
        y: rect.top - bodyRect.top - 4,
        anchorData: {
          quoted_text: selectedText,
          prefix_context: prefix,
          suffix_context: suffix,
          anchor_node_path: nodePath,
          anchor_offset: offset,
          anchor_length: selectedText.length,
        },
      });
    };

    const el = contentRef.current;
    el.addEventListener('mouseup', handleMouseUp);
    return () => el.removeEventListener('mouseup', handleMouseUp);
  }, [isEditing, contentRef]);

  // 플로팅 버튼 클릭 → 사이드바에서 새 코멘트 작성 시작
  const handleFloatingClick = useCallback(() => {
    if (floatingBtn?.anchorData && onCreateAnnotation) {
      onCreateAnnotation(floatingBtn.anchorData);
    }
    window.getSelection()?.removeAllRanges();
    setFloatingBtn(null);
  }, [floatingBtn, onCreateAnnotation]);

  // 외부 클릭으로 플로팅 버튼 닫기
  useEffect(() => {
    const handleClick = (e) => {
      if (floatingBtnRef.current && !floatingBtnRef.current.contains(e.target)) {
        setFloatingBtn(null);
      }
    };
    if (floatingBtn) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [floatingBtn]);

  if (isEditing) return null;

  const visibleMarkers = markerPositions.filter((m) => m.found);

  return (
    <>
      {/* 우측 마진 마커 */}
      {visibleMarkers.length > 0 && (
        <div className="AnnotationGutter">
          {visibleMarkers.map((m) => (
            <div
              key={m.annotation_id}
              className={`AnnotationGutter__Marker${
                m.status === 'resolved' ? ' AnnotationGutter__Marker--resolved' : ''
              }${activeAnnotationId === m.annotation_id ? ' AnnotationGutter__Marker--active' : ''}`}
              style={{ top: m.top + 4 }}
              onMouseEnter={() => handleMarkerHover(m.annotation_id, true)}
              onMouseLeave={() => handleMarkerHover(m.annotation_id, false)}
              onClick={() => onAnnotationClick?.(m.annotation_id)}
              title={t('canvas.annotations.viewComment')}
            />
          ))}
        </div>
      )}

      {/* 플로팅 댓글 버튼 */}
      {floatingBtn && (
        <div
          ref={floatingBtnRef}
          className="AnnotationFloatingBtn"
          style={{
            position: 'absolute',
            left: floatingBtn.x,
            top: floatingBtn.y,
            zIndex: 100,
          }}
        >
          <button
            className="AnnotationFloatingBtn__Btn"
            onClick={handleFloatingClick}
            title={t('canvas.annotations.addComment')}
          >
            <MessageSquarePlus size={16} />
          </button>
        </div>
      )}
    </>
  );
}
