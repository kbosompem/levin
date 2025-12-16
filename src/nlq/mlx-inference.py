#!/usr/bin/env python3
"""
MLX inference script for NLQ model.
Called as subprocess from VS Code extension.
Reads JSON from stdin, outputs JSON to stdout.

Uses Qwen2.5-7B-Instruct as base model with our LoRA adapter.
"""

import sys
import json

# Base model from mlx-community (will be auto-downloaded by mlx_lm)
BASE_MODEL = 'mlx-community/Qwen2.5-7B-Instruct-4bit'

def main():
    try:
        # Read input from stdin
        input_data = json.loads(sys.stdin.read())
        adapter_path = input_data['modelPath']  # Path to our adapter
        prompt = input_data['prompt']
        max_tokens = input_data.get('maxTokens', 100)

        # Import MLX (lazy to avoid startup cost if there's an error)
        from mlx_lm import load, generate

        # Load base model with our adapter
        model, tokenizer = load(BASE_MODEL, adapter_path=adapter_path)

        # Generate
        response = generate(
            model,
            tokenizer,
            prompt=prompt,
            max_tokens=max_tokens,
            verbose=False
        )

        # Clean up response
        text = response.strip()

        # Stop at common stop sequences
        for stop in ['<|user|>', '<|end|>', '<|endoftext|>', '<|im_end|>', '\n\n']:
            idx = text.find(stop)
            if idx != -1:
                text = text[:idx]

        print(json.dumps({'success': True, 'result': text.strip()}))

    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)

if __name__ == '__main__':
    main()
