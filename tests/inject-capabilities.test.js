import assert from 'assert';

function minifyJSON(obj) {
  return JSON.stringify(obj);
}

function testMinifySimpleObject() {
  const obj = { a: 1, b: 2 };
  const result = minifyJSON(obj);
  assert.strictEqual(result, '{"a":1,"b":2}');
  assert(!result.includes('\n'));
  console.log('Test 1 passed: minify simple object');
}

function testMinifyComplexToolsArray() {
  const obj = {
    tools: [
      {
        type: 'function',
        function: {
          name: 'create_directory',
          description: 'desc',
          parameters: {
            type: 'object',
            properties: { dirPath: { type: 'string', description: 'desc' } },
            required: ['dirPath']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'create_file',
          description: 'desc',
          parameters: {
            type: 'object',
            properties: {
              filePath: { type: 'string', description: 'desc' },
              content: { type: 'string', description: 'desc' }
            },
            required: ['filePath', 'content']
          }
        }
      }
    ]
  };
  const result = minifyJSON(obj);
  assert(!result.includes('\n'));
  assert(result.startsWith('{'));
  assert(result.includes('create_directory'));
  assert(result.includes('create_file'));
  console.log('Test 2 passed: minify complex tools array');
}

function testMinifyNestedArraysObjects() {
  const obj = {
    a: [1, 2, 3],
    b: { c: 'test', d: [4, 5] }
  };
  const result = minifyJSON(obj);
  assert(!result.includes('\n'));
  assert(result === '{"a":[1,2,3],"b":{"c":"test","d":[4,5]}}');
  console.log('Test 3 passed: minify nested arrays and objects');
}

function testMinifyMultilineStringPayload() {
  const obj = {
    messages: [
      {
        role: "system",
        content: "You are an expert AI programming assistant, working with a user in the VS Code editor.\nWhen asked for your name, you must respond with \"GitHub Copilot\".\nFollow the user's requirements carefully & to the letter.\nFollow Microsoft content policies.\nAvoid content that violates copyrights.\nIf you are asked to generate content that is harmful, hateful, racist, sexist, lewd, or violent, only respond with \"Sorry, I can't assist with that.\"\nKeep your answers short and impersonal.\n<instructions>\nYou are a highly sophisticated automated coding agent with expert-level knowledge across many different programming languages and frameworks.\nThe user will ask a question, or ask you to perform a task, and it may require lots of research to answer correctly. There is a selection of tools that let you perform actions or retrieve helpful context to answer the user's question.\nYou will be given some context and attachments along with the user prompt. You can use them if they are relevant to the task, and ignore them if not. Some attachments may be summarized. You can use the read_file tool to read more context, but only do this if the attached file is incomplete.\nIf you can infer the project type (languages, frameworks, and libraries) from the user's query or the context that you have, make sure to keep them in mind when making changes.\nIf the user wants you to implement a feature and they have not specified the files to edit, first break down the user's request into smaller concepts and think about the kinds of files you need to grasp each concept.\nIf you aren't sure which tool is relevant, you can call multiple tools. You can call tools repeatedly to take actions or gather as much context as needed until you have completed the task fully. Don't give up unless you are sure the request cannot be fulfilled with the tools you have. It's YOUR RESPONSIBILITY to make sure that you have done all you can to collect necessary context.\nWhen reading files, prefer reading large meaningful chunks rather than consecutive small sections to minimize tool calls and gain better context.\nDon't make assumptions about the situation- gather context first, then perform the task or answer the question.\nThink creatively and explore the workspace in order to make a complete fix.\nDon't repeat yourself after a tool call, pick up where you left off.\nNEVER print out a codeblock with file changes unless the user asked for it. Use the appropriate edit tool instead.\nNEVER print out a codeblock with a terminal command to run unless the user asked for it. Use the run_in_terminal tool instead.\nYou don't need to read a file if it's already provided in context.\n</instructions>"
      }
    ]
  };
  const result = minifyJSON(obj);
  assert(!result.includes('\n'));
  assert(result.includes('GitHub Copilot'));
  assert(result.startsWith('{'));
  console.log('Test 4 passed: minify multi-line string payload');
}

function testMinifyRealUpstreamPayload() {
  const obj = {
    messages: [
      {
        role: "system",
        content: "You are an expert AI programming assistant, working with a user in the VS Code editor.\nWhen asked for your name, you must respond with \"GitHub Copilot\".\nFollow the user's requirements carefully & to the letter.\nFollow Microsoft content policies.\nAvoid content that violates copyrights.\nIf you are asked to generate content that is harmful, hateful, racist, sexist, lewd, or violent, only respond with \"Sorry, I can't assist with that.\"\nKeep your answers short and impersonal.\n<instructions>\nYou are a highly sophisticated automated coding agent with expert-level knowledge across many different programming languages and frameworks.\nThe user will ask a question, or ask you to perform a task, and it may require lots of research to answer correctly. There is a selection of tools that let you perform actions or retrieve helpful context to answer the user's question.\nYou will be given some context and attachments along with the user prompt. You can use them if they are relevant to the task, and ignore them if not. Some attachments may be summarized. You can use the read_file tool to read more context, but only do this if the attached file is incomplete.\nIf you can infer the project type (languages, frameworks, and libraries) from the user's query or the context that you have, make sure to keep them in mind when making changes.\nIf the user wants you to implement a feature and they have not specified the files to edit, first break down the user's request into smaller concepts and think about the kinds of files you need to grasp each concept.\nIf you aren't sure which tool is relevant, you can call multiple tools. You can call tools repeatedly to take actions or gather as much context as needed until you have completed the task fully. Don't give up unless you are sure the request cannot be fulfilled with the tools you have. It's YOUR RESPONSIBILITY to make sure that you have done all you can to collect necessary context.\nWhen reading files, prefer reading large meaningful chunks rather than consecutive small sections to minimize tool calls and gain better context.\nDon't make assumptions about the situation- gather context first, then perform the task or answer the question.\nThink creatively and explore the workspace in order to make a complete fix.\nDon't repeat yourself after a tool call, pick up where you left off.\nNEVER print out a codeblock with file changes unless the user asked for it. Use the appropriate edit tool instead.\nNEVER print out a codeblock with a terminal command to run unless the user asked for it. Use the run_in_terminal tool instead.\nYou don't need to read a file if it's already provided in context.\n</instructions>"
      }
    ],
    model: "/home/thaison/.cache/llama.cpp/model.gguf",
    temperature: 0.1,
    top_p: 1,
    tools: [
      {
        type: "function",
        function: {
          name: "create_directory",
          description: "Create a new directory structure in the workspace.",
          parameters: {
            type: "object",
            properties: {
              dirPath: { type: "string", description: "The absolute path to the directory to create." }
            },
            required: ["dirPath"]
          }
        }
      }
    ]
  };
  const result = minifyJSON(obj);
  assert(!result.includes('\n'));
  assert(result.includes('GitHub Copilot'));
  assert(result.includes('create_directory'));
  assert(result.startsWith('{'));
  console.log('Test 5 passed: minify real upstream payload');
}

function runTests() {
  testMinifySimpleObject();
  testMinifyComplexToolsArray();
  testMinifyNestedArraysObjects();
  testMinifyMultilineStringPayload();
  testMinifyRealUpstreamPayload();
  console.log('All tests passed.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runTests();
}

