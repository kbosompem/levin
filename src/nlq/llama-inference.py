#!/usr/bin/env python3
"""
llama.cpp inference script for NLQ model.
For Windows/Linux with CUDA or CPU fallback.
Called as subprocess from VS Code extension.
Reads JSON from stdin, outputs JSON to stdout.
"""

import sys
import json


def main():
    try:
        # Read input from stdin
        input_data = json.loads(sys.stdin.read())
        model_path = input_data['modelPath']  # Path to .gguf file
        prompt = input_data['prompt']
        max_tokens = input_data.get('maxTokens', 100)

        from llama_cpp import Llama

        # Load model (auto-detects CUDA if available)
        # n_gpu_layers=-1 offloads all layers to GPU when CUDA is available
        llm = Llama(
            model_path=model_path,
            n_ctx=2048,
            n_gpu_layers=-1,
            verbose=False
        )

        # Generate
        output = llm(
            prompt,
            max_tokens=max_tokens,
            stop=['<|user|>', '<|end|>', '<|endoftext|>', '\n\n'],
            echo=False
        )

        text = output['choices'][0]['text'].strip()
        print(json.dumps({'success': True, 'result': text}))

    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
