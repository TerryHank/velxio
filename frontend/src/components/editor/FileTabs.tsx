import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../store/useEditorStore';
import './FileTabs.css';

export const FileTabs: React.FC = () => {
  const { t } = useTranslation();
  const { files, openFileIds, activeFileId, setActiveFile, closeFile } = useEditorStore();
  const [confirmCloseId, setConfirmCloseId] = useState<string | null>(null);

  const openFiles = openFileIds
    .map((id) => files.find((f) => f.id === id))
    .filter(Boolean) as typeof files;

  const handleCloseClick = (e: React.MouseEvent, fileId: string, modified: boolean) => {
    e.stopPropagation();
    if (modified) {
      setConfirmCloseId(fileId);
    } else {
      closeFile(fileId);
    }
  };

  const confirmClose = () => {
    if (confirmCloseId) closeFile(confirmCloseId);
    setConfirmCloseId(null);
  };

  return (
    <>
      <div className="file-tabs">
        {openFiles.map((file) => (
          <div
            key={file.id}
            className={`file-tab${file.id === activeFileId ? ' file-tab-active' : ''}`}
            onClick={() => setActiveFile(file.id)}
            title={file.name}
          >
            {file.modified && (
              <span className="file-tab-modified" title={t('editor.fileTabs.unsavedChanges')} />
            )}
            <span className="file-tab-name">{file.name}</span>
            <button
              className="file-tab-close"
              onClick={(e) => handleCloseClick(e, file.id, file.modified)}
              title={t('editor.fileTabs.close')}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {confirmCloseId && (
        <div className="ftabs-overlay" onClick={() => setConfirmCloseId(null)}>
          <div className="ftabs-confirm-box" onClick={(e) => e.stopPropagation()}>
            <p>{t('editor.fileTabs.confirmClose')}</p>
            <div className="ftabs-confirm-actions">
              <button className="ftabs-btn-close" onClick={confirmClose}>
                {t('editor.fileTabs.closeAnyway')}
              </button>
              <button onClick={() => setConfirmCloseId(null)}>{t('editor.fileTabs.cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
