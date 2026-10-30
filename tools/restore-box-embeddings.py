"""Restore native SAM box-corner embeddings omitted from the point-only ONNX export.

Requires numpy and onnx. Pass the original nielsr/slimsam-77-uniform model.safetensors
checkpoint path. The vision encoder and decoder weights remain unchanged; this adds
the original learned corner vectors to the prompt encoder for labels 2 and 3.
"""
import json
import pathlib
import struct
import sys
import numpy as np
import onnx
from onnx import helper, numpy_helper

root = pathlib.Path(__file__).resolve().parents[1]
with open(sys.argv[1], "rb") as f:
    size = struct.unpack("<Q", f.read(8))[0]
    header = json.loads(f.read(size))
    offset = 8 + size
    weights = {}
    for label in range(4):
        entry = header[f"prompt_encoder.point_embed.{label}.weight"]
        assert entry["dtype"] == "F32"
        start, end = entry["data_offsets"]
        f.seek(offset + start)
        weights[label] = np.frombuffer(f.read(end - start), dtype="<f4").copy().reshape(1, 1, 1, 256)

for filename in ["prompt_encoder_mask_decoder.onnx", "prompt_encoder_mask_decoder_quantized.onnx"]:
    target = root / "public/models/slimsam-trace-v1/onnx" / filename
    model = onnx.load(target)
    if any(n.name == "trace_box_2_equal" for n in model.graph.node):
        print(filename, "already supports box prompts")
        continue
    originals = {x.name: x for x in model.graph.initializer}
    for label, name in [(0, "onnx::Add_1927"), (1, "onnx::Add_1929")]:
        np.testing.assert_array_equal(numpy_helper.to_array(originals[name]), weights[label])
    original_output = "/prompt_encoder/Where_3_output_0"
    final_output = "trace_box_3_output"
    for node in model.graph.node:
        for i, value in enumerate(node.input):
            if value == original_output:
                node.input[i] = final_output
    additions = []
    previous = original_output
    for label in [2, 3]:
        prefix = f"trace_box_{label}"
        model.graph.initializer.extend([
            numpy_helper.from_array(np.array(float(label), dtype=np.float32), prefix + "_label"),
            numpy_helper.from_array(weights[label], prefix + "_embedding"),
        ])
        additions.extend([
            helper.make_node("Equal", ["/prompt_encoder/Concat_3_output_0", prefix+"_label"], [prefix+"_condition"], name=prefix+"_equal"),
            helper.make_node("Unsqueeze", [prefix+"_condition", "/prompt_encoder/Constant_17_output_0"], [prefix+"_broadcast"], name=prefix+"_unsqueeze"),
            helper.make_node("Add", [previous, prefix+"_embedding"], [prefix+"_sum"], name=prefix+"_add"),
            helper.make_node("Where", [prefix+"_broadcast", prefix+"_sum", previous], [prefix+"_output"], name=prefix+"_where"),
        ])
        previous = prefix + "_output"
    nodes = list(model.graph.node)
    index = next(i for i,n in enumerate(nodes) if n.name == "/prompt_encoder/Where_3") + 1
    del model.graph.node[:]
    model.graph.node.extend(nodes[:index] + additions + nodes[index:])
    onnx.checker.check_model(model)
    onnx.save(model, target)
    print(filename, "native corner embeddings restored")
