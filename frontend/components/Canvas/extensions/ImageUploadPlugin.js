import { Plugin } from '@tiptap/pm/state';
import { axios } from '@/library/_axios';
import { showToast } from '@/components/Layout/Toast';
import { getErrorCode } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
// React 밖(ProseMirror plugin)에서 불리므로 훅이 아니라 i18next 인스턴스를 직접 읽는다
// (library/errorText.js와 동일한 패턴).
import i18next from '@/library/i18n';

const MAX_IMAGE_SIZE_MB = 10;
const MAX_IMAGE_SIZE = MAX_IMAGE_SIZE_MB * 1024 * 1024;

// 백엔드 업로드 실패 코드 → 사용자 안내 메시지
function uploadErrorMessage(code) {
  switch (code) {
    case 'FILE_TOO_LARGE':
      return i18next.t('canvasExt.imageUpload.tooLarge', { size: MAX_IMAGE_SIZE_MB });
    case 'INVALID_FILE_TYPE':
    case 'INVALID_FILE_CONTENT':
      return i18next.t('canvasExt.imageUpload.invalidType');
    case 'NOT_CANVAS_MEMBER':
    case 'NOT_BRANCH_MEMBER':
      return i18next.t('canvasExt.imageUpload.noPermission');
    case 'NO_FILE':
      return i18next.t('canvasExt.imageUpload.noFile');
    default:
      return i18next.t('canvasExt.imageUpload.failed');
  }
}

export function createImageUploadPlugin({ canvasId, branchId }) {
  return new Plugin({
    props: {
      handlePaste(view, event) {
        const items = Array.from(event.clipboardData?.items || []);
        const imageItem = items.find((item) => item.type.startsWith('image/'));
        if (!imageItem) return false;

        event.preventDefault();
        const file = imageItem.getAsFile();
        if (file) uploadAndInsert(file, { canvasId, branchId }, view);
        return true;
      },

      handleDrop(view, event) {
        const files = Array.from(event.dataTransfer?.files || []);
        const imageFile = files.find((f) => f.type.startsWith('image/'));
        if (!imageFile) return false;

        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
        uploadAndInsert(imageFile, { canvasId, branchId }, view, pos?.pos);
        return true;
      },
    },
  });
}

function getUploadUrl({ canvasId, branchId }) {
  if (canvasId) return `/canvases/${canvasId}/pages/upload-image`;
  if (branchId) return `/branches/${branchId}/tasks/upload-image`;
  return null;
}

async function uploadAndInsert(file, context, view, insertPos) {
  if (file.size > MAX_IMAGE_SIZE) {
    showToast(uploadErrorMessage('FILE_TOO_LARGE'), 'error');
    return;
  }

  const url = getUploadUrl(context);
  if (!url) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await axios.post(url, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });

    if (res.data.status && res.data.url) {
      const { schema } = view.state;
      const node = schema.nodes.image.create({ src: res.data.url });
      const pos = insertPos != null ? insertPos : view.state.selection.from;
      const tr = view.state.tr.insert(pos, node);
      view.dispatch(tr);
    } else {
      const code = getErrorCode(res.data);
      const msg = errorText(code, null) ?? uploadErrorMessage(code);
      showToast(msg, 'error');
    }
  } catch {
    showToast(uploadErrorMessage(), 'error');
  }
}
