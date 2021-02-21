import * as cdk from '@aws-cdk/core';
import lambda = require('@aws-cdk/aws-lambda');
import s3 = require('@aws-cdk/aws-s3');
import s3Deployment = require('@aws-cdk/aws-s3-deployment');
import * as sfn from "@aws-cdk/aws-stepfunctions";
import * as tasks from "@aws-cdk/aws-stepfunctions-tasks";
import { Fail, Pass } from '@aws-cdk/aws-stepfunctions';
import iam = require('@aws-cdk/aws-iam');
import { ApiToStateMachine } from './ApiToStateMachine';

export class BackendStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // =====================================================================================
    //Public Bucket to store website created by the application
    // =====================================================================================
    const websiteBucket = new s3.Bucket(this, "audioposts-931", {
      publicReadAccess: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      websiteIndexDocument: 'index.html',
    });
    new cdk.CfnOutput(this, 'resizedBucket', {value: websiteBucket.bucketName});

    const deployment = new s3Deployment.BucketDeployment(
      this,
      'deployStaticWebsite',
      {
        sources: [s3Deployment.Source.asset('../frontend')],
        destinationBucket: websiteBucket,
      }
    );

    const role = new iam.Role(this, 'LambdaPostsReaderRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
   
    const policy = new iam.ManagedPolicy(this, "MyServerlessAppPolicy", {
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "ses:SendEmail",
            "logs:CreateLogGroup",
            "logs:CreateLogStream",
            "logs:PutLogEvents"
          ],
          resources: ["*"]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "sns:Publish"
          ],
          resources: ["*"]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "states:*"
          ],
          resources: ["*"]
        })
      ]
    });
   
    // Creates a managed policy and then attaches the policy to role
    policy.attachToRole(role);

    // =====================================================================================
    //Lambda function to send email reminder
    // =====================================================================================
    const emailReminder = new lambda.Function(this, 'Email_Reminder', {
      code: lambda.Code.fromAsset('lambda'),
      runtime: lambda.Runtime.PYTHON_3_7,
      handler: 'email_reminder.lambda_handler',
      role: role,
      environment: {
        "VERIFIED_EMAIL": "someone@gmail.com"
      }
    });

    // =====================================================================================
    //Lambda function to send email reminder
    // =====================================================================================
    const smsReminder = new lambda.Function(this, 'SMS_Reminder', {
      code: lambda.Code.fromAsset('lambda'),
      runtime: lambda.Runtime.PYTHON_3_7,
      handler: 'sms_reminder.lambda_handler',
      role: role,
    });

    // =====================================================================================
    //State Machine to send email and sms
    // =====================================================================================
    const waitTask = new sfn.Wait(this, "Wait 1 Second", {
      time: sfn.WaitTime.secondsPath('$.waitSeconds')
    })

    const emailTask = new tasks.LambdaInvoke(this, "Send Email", {
      lambdaFunction: emailReminder,
      outputPath: "$.Payload",
    });
    
    const smsTask = new tasks.LambdaInvoke(this, "Send SMS", {
      lambdaFunction: smsReminder,
      outputPath: "$.Payload",
    });

    const firstSendEmailTask = new tasks.LambdaInvoke(this, "First send email", {
      lambdaFunction: emailReminder,
      outputPath: "$.Payload",
    });
    
    const secondSendSMSTask = new tasks.LambdaInvoke(this, "Second send SMS", {
      lambdaFunction: smsReminder,
      outputPath: "$.Payload",
    });

    const parallel = new sfn.Parallel(this, 'taskParallelTasks', {}).branch(firstSendEmailTask).branch(secondSendSMSTask);

    //https://docs.aws.amazon.com/cdk/api/latest/docs/aws-stepfunctions-readme.html#choice
    const choice = new sfn.Choice(this,'ChoiceState');
    choice.when(sfn.Condition.stringEquals("$.preference","email"),emailTask);
    choice.when(sfn.Condition.stringEquals("$.preference","sms"),smsTask);
    choice.when(sfn.Condition.stringEquals("$.preference","both"),parallel);
    //Use .otherwise() to indicate what should be done if none of the conditions match
    choice.otherwise(new Fail(this,"No Matches"));
    // Use .afterwards() to join all possible paths back together and continue
    choice.afterwards().next(new Pass(this,"Pass"));

    const definition = sfn.Chain
      .start(waitTask) 
      .next(choice);

    const machine = new sfn.StateMachine(this, "StateMachine", {
      definition,
      timeout: cdk.Duration.minutes(5),
    }); 

    const apiFunction = new lambda.Function(this, 'APIFunction', {
      code: lambda.Code.fromAsset('lambda'),
      runtime: lambda.Runtime.PYTHON_3_7,
      handler: 'api_handler.lambda_handler',
      role: role,
    });

    // =====================================================================================
    //API Gateway service integration with State Machine
    // =====================================================================================
    const apiToStateMachine = new ApiToStateMachine(this,'ApiToStateMachine',{
      stateMachine: machine
    });

    /* 
    To test email
    {
      "waitSeconds": 10,
      "preference": "email",
      "message": "Hello! this works, but remember your cat needs something",
      "email": "someone@gmail.com",
      "phone": "+00000000000"
    }
    To test sms
    {
      "waitSeconds": 10,
      "preference": "sms",
      "message": "Hello! this works, but remember your cat needs something",
      "email": "someone@gmail.com",
      "phone": "+00000000000"
    }
    To test both
    {
      "waitSeconds": 10,
      "preference": "both",
      "message": "Hello! this works, but remember your cat needs something",
      "email": "someone@gmail.com",
      "phone": "+00000000000"
    }
    */

  }
}
