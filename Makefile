export EMCC_WASM_BACKEND = 1
export EMCC_EXPERIMENTAL_USE_LLD = 1

all: vmsg.wasm

lame-svn/lame/dist/lib/libmp3lame.so:
	cd lame-svn/lame && \
	git reset --hard && \
	patch -p2 < ../../lame-svn.patch && \
	emconfigure ./configure \
		CFLAGS="-DNDEBUG -Oz" \
		--prefix="$$(pwd)/dist" \
		--host=x86-none-linux \
		--disable-static \
		\
		--disable-gtktest \
		--disable-analyzer-hooks \
		--disable-decoder \
		--disable-frontend \
		&& \
	emmake make -j8 && \
	emmake make install

# WASM backend doesn't support EMSCRIPTEN_KEEPALIVE, see:
# https://github.com/kripken/emscripten/issues/6233
# Output to bare .wasm doesn't work properly so need to create
# intermediate files.
vmsg.wasm: lame-svn/lame/dist/lib/libmp3lame.so vmsg.c
	emcc $^ \
		-DNDEBUG -Oz --llvm-lto 3 -Ilame-svn/lame/dist/include \
		-s WASM=1 \
		-s "EXPORTED_FUNCTIONS=['_vmsg_init','_vmsg_encode','_vmsg_flush','_vmsg_free']" \
		-o _vmsg.js
	cp _vmsg.wasm $@

clean: clean-lame clean-wasm
clean-lame:
	cd lame-svn && git clean -dfx
clean-wasm:
	rm -f vmsg.wasm _vmsg.*
