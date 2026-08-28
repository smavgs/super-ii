import gradio as gr

demo = gr.Interface(
    fn=lambda value: value,
    inputs=gr.Textbox(label="Input"),
    outputs=gr.Textbox(label="Output"),
    title="Super ii isolated Space smoke test",
)
