sed -i '/{mode === .batch. && capturedImages.length > 0 && (/c\
            {mode === "batch" && capturedImages.length > 0 ? (\
' src/components/CameraView.tsx
sed -i '/<\/div>$/,/)}/c\
                </div>\
              </div>\
            ) : (\
              <button onClick={() => { onPickGallery?.(); onClose(); }} className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20">\
                <ImageIcon className="w-6 h-6 text-white" />\
              </button>\
            )}\
' src/components/CameraView.tsx
